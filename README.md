# PDF Fixer

A lightweight web application that converts PDFs to be compatible with Document Builder using [Ghostscript](https://www.ghostscript.com/).

Uploaded files are re-processed with Ghostscript to produce a **PDF 1.3**, A4-sized, printer-quality output — and the converted file keeps its **original file name**.

## Features

- **Drag & drop** or browse to upload a PDF
- Converts to PDF 1.3 (A4, printer quality) via Ghostscript
- **Preserves original file names** on download
- Responsive UI that works on mobile, tablet, and desktop
- Success and error feedback with a loading indicator
- Runs in Docker for easy deployment

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Ghostscript](https://www.ghostscript.com/) installed and available as `gs`

### Run Locally

```bash
npm install
mkdir -p uploads outputs
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Run with Docker

```bash
docker build -t pdf-fixer .
docker run -p 3000:3000 pdf-fixer
```

## API

### `POST /convert`

Upload a PDF file as multipart form data with the field name `pdf`.

Returns the converted PDF with the original file name preserved.

**Example with curl:**

```bash
curl -X POST -F "pdf=@myfile.pdf" http://localhost:3000/convert --output myfile.pdf
```

## Tech Stack

- **Node.js** + **Express** — web server
- **Multer** — file upload handling
- **Ghostscript** — PDF conversion
- **Tailwind CSS** (CDN) — UI styling

## License

ISC
