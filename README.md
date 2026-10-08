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

### Lint and test

```bash
npm run lint   # ESLint (eslint.config.js)
npm test       # node:test, uses a stub gs so Ghostscript is not needed
```

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

Error responses:

| Status | Meaning |
| ------ | ------- |
| 400 | No file, not a PDF, or a malformed upload |
| 413 | File is larger than `MAX_UPLOAD_MB` |
| 429 | Rate limit exceeded (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`, per IP) |
| 500 | Ghostscript failed or timed out |
| 503 | `MAX_CONCURRENT_JOBS` conversions already running; retry shortly |

### `GET /healthz`

Returns `200 ok`. Use this as the health check path.

## Configuration

All environment variables are optional; see [`.env.example`](.env.example) for the defaults.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `PORT` | `3000` | HTTP port |
| `MAX_UPLOAD_MB` | `50` | Maximum upload size |
| `GS_TIMEOUT_MS` | `120000` | Ghostscript timeout per conversion |
| `MAX_CONCURRENT_JOBS` | `2` | Concurrent Ghostscript jobs |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window for `POST /convert` |
| `RATE_LIMIT_MAX` | `60` | Conversions per IP per window |
| `TRUST_PROXY` | `1` | Express `trust proxy` (proxy hops in front of the app) |

## Tech Stack

- **Node.js** + **Express** — web server
- **Multer** — file upload handling
- **Ghostscript** — PDF conversion
- **Tailwind CSS** (CDN) — UI styling

## License

ISC
