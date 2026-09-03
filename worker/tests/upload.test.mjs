import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const secret = "upload-test-signing-secret";
const sourceId = "12345678-1234-1234-1234-123456789012";

function ticket(claim) {
  const encoded = Buffer.from(JSON.stringify(claim)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

async function waitForWorker(url) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("Worker did not start.");
}

test("resumes Fly volume uploads and serves protected byte ranges", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencast-upload-test-"));
  const port = 20_000 + Math.floor(Math.random() * 10_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const worker = spawn(process.execPath, ["src/index.mjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(port),
      OPENCAST_WORK_DIR: directory,
      OPENCAST_WORKER_SIGNING_SECRET: secret,
      CORS_ORIGIN: "http://example.test",
    },
    stdio: "ignore",
  });
  try {
    await waitForWorker(baseUrl);
    const uploadTicket = ticket({
      kind: "upload",
      sourceId,
      filename: "episode.mp3",
      size: 11,
      contentType: "audio/mpeg",
      expiresAt: Date.now() + 60_000,
    });
    const headers = { authorization: `Bearer ${uploadTicket}` };
    const prepared = await fetch(`${baseUrl}/uploads`, { method: "POST", headers });
    assert.equal(prepared.status, 200);
    assert.equal((await prepared.json()).offset, 0);

    const first = await fetch(`${baseUrl}/uploads`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/offset+octet-stream", "upload-offset": "0" },
      body: Buffer.from("hello "),
    });
    assert.equal(first.status, 204);
    assert.equal(first.headers.get("upload-offset"), "6");

    const resumed = await fetch(`${baseUrl}/uploads`, { method: "HEAD", headers });
    assert.equal(resumed.status, 204);
    assert.equal(resumed.headers.get("upload-offset"), "6");

    const final = await fetch(`${baseUrl}/uploads`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/offset+octet-stream", "upload-offset": "6" },
      body: Buffer.from("world"),
    });
    assert.equal(final.status, 204);
    assert.equal(final.headers.get("upload-offset"), "11");

    const mediaTicket = ticket({ kind: "media", sourceId, expiresAt: Date.now() + 60_000 });
    const media = await fetch(`${baseUrl}/media/${sourceId}?ticket=${encodeURIComponent(mediaTicket)}`, { headers: { range: "bytes=6-10" } });
    assert.equal(media.status, 206);
    assert.equal(media.headers.get("content-range"), "bytes 6-10/11");
    assert.equal(await media.text(), "world");
  } finally {
    worker.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  }
});
