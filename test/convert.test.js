// Runs the app in-process with a stub `gs` on PATH, so Ghostscript is not needed.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-fixer-gs-"));
fs.writeFileSync(
  path.join(stubDir, "gs"),
  // Inputs containing SLOW make the stub take a second, to hold a job slot
  '#!/bin/sh\nfor a in "$@"; do case "$a" in -sOutputFile=*) out="${a#-sOutputFile=}";; esac; last="$a"; done\n' +
    'if grep -q SLOW "$last"; then sleep 1; fi\ncp "$last" "$out"\n',
  { mode: 0o755 }
);
process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;
process.env.MAX_UPLOAD_MB = "1";
process.env.MAX_CONCURRENT_JOBS = "1";

const app = require("../server");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(stubDir, { recursive: true, force: true });
});

const postFile = (contents, name = "test.pdf", type = "application/pdf") => {
  const form = new FormData();
  form.append("pdf", new Blob([contents], { type }), name);
  return fetch(`${baseUrl}/convert`, { method: "POST", body: form });
};

test("GET /healthz returns ok", async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), "ok");
});

test("GET / serves the upload page without X-Powered-By", async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /PDF Fixer/);
  assert.strictEqual(res.headers.get("x-powered-by"), null);
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /cdn\.tailwindcss\.com/);
});

test("GET / loads the prebuilt stylesheet and script from this origin", async () => {
  const html = await (await fetch(`${baseUrl}/`)).text();
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /(src|href)="https?:/);
  for (const asset of ["styles.css", "app.js"]) {
    const res = await fetch(`${baseUrl}/${asset}`);
    assert.strictEqual(res.status, 200, asset);
  }
});

test("POST /convert without a file returns 400", async () => {
  const res = await fetch(`${baseUrl}/convert`, { method: "POST", body: new FormData() });
  assert.strictEqual(res.status, 400);
});

test("POST /convert rejects a non-PDF", async () => {
  const res = await postFile("not a pdf", "notes.txt", "text/plain");
  assert.strictEqual(res.status, 400);
});

test("POST /convert rejects a .pdf without a PDF header", async () => {
  const res = await postFile("dummy pdf");
  assert.strictEqual(res.status, 400);
});

test("POST /convert rejects files over the size limit", async () => {
  const res = await postFile(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2 * 1024 * 1024)]));
  assert.strictEqual(res.status, 413);
});

test("POST /convert returns the converted PDF with the original name", async () => {
  const pdf = "%PDF-1.4\n%%EOF\n";
  const res = await postFile(pdf, "My Invoice.pdf");
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /My Invoice\.pdf/);
  assert.strictEqual(await res.text(), pdf);
});

test("POST /convert is not blocked by a stalled upload", async () => {
  // Send the start of a multipart body and never finish it
  const boundary = "stalled-upload";
  const req = http.request(`${baseUrl}/convert`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
  });
  req.on("error", () => {});
  req.write(
    `--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="slow.pdf"\r\n` +
      "Content-Type: application/pdf\r\n\r\n%PDF-1.4\n"
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const res = await postFile("%PDF-1.4\n%%EOF\n");
    assert.strictEqual(res.status, 200);
  } finally {
    req.destroy();
  }
});

test("POST /convert returns 503 while Ghostscript is at capacity", async () => {
  const slow = postFile("%PDF-1.4\nSLOW\n%%EOF\n");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const busy = await postFile("%PDF-1.4\n%%EOF\n");
  assert.strictEqual(busy.status, 503);
  assert.strictEqual(busy.headers.get("retry-after"), "10");
  assert.strictEqual((await slow).status, 200);
  const after = await postFile("%PDF-1.4\n%%EOF\n");
  assert.strictEqual(after.status, 200);
});
