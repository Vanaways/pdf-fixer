// File: server.js
const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: "uploads/" });

app.use(express.static("public"));

app.post("/convert", upload.single("pdf"), (req, res) => {
  const inputPath = req.file.path;
  const outputPath = path.join("outputs", `${req.file.filename}_converted.pdf`);

  const cmd = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.3 -dPDFSETTINGS=/printer -dPDFFitPage -dFIXEDMEDIA -sPAPERSIZE=a4 -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${outputPath} ${inputPath}`;

  exec(cmd, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error processing PDF");
    }
    res.download(outputPath, "converted.pdf", () => {
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
    });
  });
});

app.listen(PORT, () => console.log(`PDF converter running on port ${PORT}`));
