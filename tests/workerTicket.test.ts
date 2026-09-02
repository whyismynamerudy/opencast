import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { isProjectMediaUrl, issueWorkerJobTicket } from "../lib/workerTicket";

process.env.OPENCAST_WORKER_SIGNING_SECRET = "test-worker-signing-secret";

const sourceUrl = "https://store-id.public.blob.vercel-storage.com/opencast/source-id/video.mp4";
const ticket = issueWorkerJobTicket({ sourceUrl, sourceId: "12345678-1234-1234-1234-123456789012", filename: "episode.mp4" });
const [encoded, signature] = ticket.split(".");
const claim = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));

assert.equal(claim.sourceUrl, sourceUrl);
assert.equal(claim.filename, "episode.mp4");
assert.equal(claim.sourceId, "12345678-1234-1234-1234-123456789012");
assert.ok(claim.expiresAt > Date.now());
assert.equal(signature, createHmac("sha256", process.env.OPENCAST_WORKER_SIGNING_SECRET).update(encoded).digest("base64url"));
assert.equal(isProjectMediaUrl(sourceUrl), true);
assert.equal(isProjectMediaUrl("https://example.com/opencast/video.mp4"), false);
assert.equal(isProjectMediaUrl("http://store-id.public.blob.vercel-storage.com/opencast/video.mp4"), false);

console.log("worker ticket tests passed");
