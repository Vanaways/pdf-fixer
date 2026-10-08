// Runs the app in-process with a stub `gs` on PATH, so Ghostscript is not needed.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-fixer-gs-"));
fs.writeFileSync(
  path.join(stubDir, "gs"),
  '#!/bin/sh\nfor a in "$@"; do case "$a" in -sOutputFile=*) out="${a#-sOutputFile=}";; esac; last="$a"; done\ncp "$last" "$out"\n',
  { mode: 0o755 }
);
process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;
process.env.MAX_UPLOAD_MB = "1";

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
  assert.ok(res.headers.get("content-security-policy"));
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
