# PDF Fixer

A lightweight web application that converts PDFs to be compatible with Document Builder using [Ghostscript](https://www.ghostscript.com/).

Uploaded files are re-processed with Ghostscript to produce a **PDF 1.3**, A4-sized, printer-quality output — and the converted file keeps its **original file name**.

- **Live:** https://pdf-fixer.vanaways.co.uk
- **Dev:** none

## Features

- **Drag & drop** or browse to upload a PDF
- Converts to PDF 1.3 (A4, printer quality) via Ghostscript
- **Preserves original file names** on download
- Responsive UI that works on mobile, tablet, and desktop
- Success and error feedback with a loading indicator
- Runs in Docker for easy deployment

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 24 (see `.nvmrc`)
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

### Styles

The page uses Tailwind CSS 3, prebuilt into `public/styles.css` (committed, so the Docker image needs no build step). After changing classes in `public/index.html` or `public/app.js`, rebuild and commit it:

```bash
npm run build:css
```

### Run with Docker

```bash
docker build -t pdf-fixer .
docker run -p 3000:3000 pdf-fixer
```

The image is based on `node:24-bookworm-slim` with Ghostscript installed, and runs as the unprivileged `node` user.

## Deployment

Deployed on **Coolify** from the `Dockerfile` on the `main` branch (https://pdf-fixer.vanaways.co.uk). Merging to `main` and redeploying in Coolify ships a change.

- Port: `3000` (override with `PORT`)
- Health check: `GET /` returns 200 (the Dockerfile `HEALTHCHECK` uses it)
- No secrets are required.

## Development

CI (`.github/workflows/ci.yml`) runs on every pull request and on pushes to `main`: `npm ci`, a syntax check, `npm test` (when present), a smoke test of `GET /`, and a Docker build that checks Ghostscript and app start inside the image. Dependabot opens grouped weekly updates for npm, GitHub Actions and the Docker base image.

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
- **Tailwind CSS** (prebuilt, no CDN) — UI styling

## License

ISC
