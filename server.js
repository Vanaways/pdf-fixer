const express = require("express");
const multer = require("multer");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure runtime directories exist
for (const dir of ["uploads", "outputs"]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Configure multer with file size limit and pdf-only filter
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per file
  fileFilter(_req, file, cb) {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

app.use(express.static("public"));

// In-memory job store: jobId -> { files: [{ originalName, status, progress, error }], ready: bool }
const jobs = new Map();

// Clean up old jobs every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) {
      // Clean up any remaining files
      for (const f of job.files) {
        for (const p of [f.inputPath, f.outputPath]) {
          if (p) try { fs.unlinkSync(p); } catch {}
        }
      }
      jobs.delete(id);
    }
  }
}, 30 * 60 * 1000);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Upload endpoint — accepts multiple PDFs, returns a job ID
app.post("/convert", upload.array("pdf", 50), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No PDF files uploaded" });
  }

  const jobId = crypto.randomUUID();
  const files = req.files.map((f) => ({
    originalName: f.originalname,
    inputPath: f.path,
    outputPath: path.join("outputs", `${f.filename}_converted.pdf`),
    status: "queued",
    progress: 0,
    error: null,
  }));

  jobs.set(jobId, { files, createdAt: Date.now() });

  // Start processing all files
  for (const file of files) {
    processFile(jobId, file);
  }

  res.json({ jobId, fileCount: files.length });
});

// SSE endpoint — streams real-time progress for a job
app.get("/progress/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = () => {
    const data = job.files.map(({ originalName, status, progress, error }) => ({
      originalName,
      status,
      progress,
      error,
    }));
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial state immediately
  send();

  const interval = setInterval(send, 500);

  // Check for completion
  const doneCheck = setInterval(() => {
    const allDone = job.files.every(
      (f) => f.status === "done" || f.status === "error"
    );
    if (allDone) {
      send(); // final update
      res.write(`event: complete\ndata: done\n\n`);
      clearInterval(interval);
      clearInterval(doneCheck);
      res.end();
    }
  }, 300);

  req.on("close", () => {
    clearInterval(interval);
    clearInterval(doneCheck);
  });
});

// Download a single converted file by job + index
app.get("/download/:jobId/:index", (req, res) => {
  const job = jobs.get(req.params.jobId);
  const index = parseInt(req.params.index, 10);
  if (!job || isNaN(index) || !job.files[index]) {
    return res.status(404).json({ error: "File not found" });
  }

  const file = job.files[index];
  if (file.status !== "done") {
    return res.status(400).json({ error: "File not ready" });
  }

  // Derive a friendly download name from the original
  const ext = path.extname(file.originalName);
  const base = path.basename(file.originalName, ext);
  const downloadName = `${base}_fixed${ext || ".pdf"}`;

  res.download(file.outputPath, downloadName, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: "Download failed" });
    }
  });
});

// Download all converted files as individual downloads aren't great for batch,
// so we zip them. We use `tar` which is available everywhere in Linux.
app.get("/download-all/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  const doneFiles = job.files.filter((f) => f.status === "done");
  if (doneFiles.length === 0) {
    return res.status(400).json({ error: "No files ready for download" });
  }

  // If only one file, just download it directly
  if (doneFiles.length === 1) {
    const file = doneFiles[0];
    const ext = path.extname(file.originalName);
    const base = path.basename(file.originalName, ext);
    return res.download(file.outputPath, `${base}_fixed${ext || ".pdf"}`);
  }

  // For multiple files, create a zip
  const zipPath = path.join("outputs", `${req.params.jobId}_batch.zip`);

  // Build zip command with safe filenames
  const args = ["-j", zipPath];
  for (const f of doneFiles) {
    args.push(f.outputPath);
  }

  const zipProc = spawn("zip", args);
  zipProc.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: "Failed to create zip" });
    }
    res.download(zipPath, "pdf_fixed_batch.zip", () => {
      try { fs.unlinkSync(zipPath); } catch {}
    });
  });
});

// Clean up a job's files after user is done
app.delete("/job/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  for (const f of job.files) {
    for (const p of [f.inputPath, f.outputPath]) {
      if (p) try { fs.unlinkSync(p); } catch {}
    }
  }
  jobs.delete(req.params.jobId);
  res.json({ status: "cleaned" });
});

// Process a single PDF file using Ghostscript (spawned for streaming output)
function processFile(_jobId, file) {
  file.status = "processing";
  file.progress = 10;

  const args = [
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.3",
    "-dPDFSETTINGS=/printer",
    "-dPDFFitPage",
    "-dFIXEDMEDIA",
    "-sPAPERSIZE=a4",
    "-dNOPAUSE",
    "-dBATCH",
    `-sOutputFile=${file.outputPath}`,
    file.inputPath,
  ];

  const gs = spawn("gs", args);

  let pageCount = 0;

  gs.stdout.on("data", (data) => {
    const text = data.toString();
    // Ghostscript outputs "Page N" as it processes pages
    const pages = text.match(/Page \d+/g);
    if (pages) {
      pageCount += pages.length;
      // Ramp progress from 10 to 90 based on pages processed
      file.progress = Math.min(10 + pageCount * 5, 90);
    }
  });

  gs.stderr.on("data", (data) => {
    const text = data.toString();
    const pages = text.match(/Page \d+/g);
    if (pages) {
      pageCount += pages.length;
      file.progress = Math.min(10 + pageCount * 5, 90);
    }
  });

  gs.on("close", (code) => {
    if (code !== 0) {
      file.status = "error";
      file.error = "Ghostscript conversion failed";
      file.progress = 0;
      // Clean up input
      try { fs.unlinkSync(file.inputPath); } catch {}
    } else {
      file.status = "done";
      file.progress = 100;
      // Clean up input, keep output until download
      try { fs.unlinkSync(file.inputPath); } catch {}
    }
  });

  gs.on("error", (err) => {
    file.status = "error";
    file.error = err.message;
    file.progress = 0;
  });
}

// Multer error handler
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large (max 100MB)" });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message === "Only PDF files are allowed") {
    return res.status(400).json({ error: err.message });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, "0.0.0.0", () =>
  console.log(`PDF converter running on port ${PORT}`)
);
