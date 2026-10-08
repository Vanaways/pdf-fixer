// File: server.js
const express = require("express");
const multer = require("multer");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = "uploads";
const OUTPUT_DIR = "outputs";

const intFromEnv = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const MAX_UPLOAD_MB = intFromEnv("MAX_UPLOAD_MB", 50);
const GS_TIMEOUT_MS = intFromEnv("GS_TIMEOUT_MS", 120000);
const MAX_CONCURRENT_JOBS = intFromEnv("MAX_CONCURRENT_JOBS", 2);
const RATE_LIMIT_WINDOW_MS = intFromEnv("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000);
const RATE_LIMIT_MAX = intFromEnv("RATE_LIMIT_MAX", 60);

// Behind Coolify's reverse proxy there is one hop; needed so rate limiting
// keys on the real client IP rather than the proxy's.
const parseTrustProxy = (value) => {
  if (value === undefined || value === "") return 1;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        // index.html uses an inline script and the Tailwind Play CDN
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      },
    },
  })
);

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const looksLikePdf =
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/octet-stream" ||
      /\.pdf$/i.test(file.originalname || "");
    cb(null, looksLikePdf);
  },
});

const convertLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many conversions, please try again later",
});

// PDFs must contain the %PDF- header within the first 1024 bytes
const hasPdfHeader = async (filePath) => {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes("%PDF-");
  } finally {
    await handle.close();
  }
};

const runGhostscript = (inputPath, outputPath) =>
  new Promise((resolve, reject) => {
    const args = [
      "-dSAFER",
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.3",
      "-dPDFSETTINGS=/printer",
      "-dPDFFitPage",
      "-dFIXEDMEDIA",
      "-sPAPERSIZE=a4",
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      `-sOutputFile=${outputPath}`,
      inputPath,
    ];
    execFile("gs", args, { timeout: GS_TIMEOUT_MS }, (err) => (err ? reject(err) : resolve()));
  });

const removeFiles = (...files) =>
  Promise.all(files.filter(Boolean).map((file) => fs.promises.rm(file, { force: true })));

// Ghostscript jobs currently running. Only the gs step counts, so slow or
// stalled uploads cannot occupy a slot and lock other users out.
let activeJobs = 0;

// Serve static files from /public
app.use(express.static("public"));

// Health check route for Coolify
app.get("/healthz", (req, res) => {
  res.send("ok");
});

app.post("/convert", convertLimiter, upload.single("pdf"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("Please upload a PDF file in the 'pdf' field");
  }

  const inputPath = req.file.path;
  const originalName = path.basename(req.file.originalname || "converted.pdf");
  const outputPath = path.join(OUTPUT_DIR, `${req.file.filename}_converted.pdf`);

  try {
    if (!(await hasPdfHeader(inputPath))) {
      await removeFiles(inputPath);
      return res.status(400).send("Uploaded file is not a PDF");
    }
  } catch (err) {
    console.error(err);
    await removeFiles(inputPath);
    return res.status(500).send("Error processing PDF");
  }

  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    await removeFiles(inputPath);
    res.set("Retry-After", "10");
    return res.status(503).send("Server busy, please try again shortly");
  }

  // The slot is held until gs exits, even if the client disconnects, so
  // aborting the request cannot be used to bypass the cap.
  activeJobs++;
  try {
    await runGhostscript(inputPath, outputPath);
  } catch (err) {
    console.error(err);
    await removeFiles(inputPath, outputPath);
    return res.status(500).send("Error processing PDF");
  } finally {
    activeJobs--;
  }

  res.download(outputPath, originalName, (err) => {
    if (err) console.error(err);
    removeFiles(inputPath, outputPath).catch((rmErr) => console.error(rmErr));
  });
});

// Upload errors (size/file-count limits, malformed multipart bodies)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (req.file) removeFiles(req.file.path).catch(() => {});
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message =
      err.code === "LIMIT_FILE_SIZE" ? `PDF is larger than ${MAX_UPLOAD_MB} MB` : "Invalid upload";
    return res.status(status).send(message);
  }
  console.error(err);
  if (req.path === "/convert") {
    // Anything else here is a malformed multipart body
    return res.status(400).send("Invalid upload");
  }
  res.status(500).send("Server error");
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => console.log(`PDF converter running on port ${PORT}`));
}

module.exports = app;
