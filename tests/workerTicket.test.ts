import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { issueWorkerJobTicket, issueWorkerMediaTicket, issueWorkerUploadTicket } from "../lib/workerTicket";

process.env.OPENCAST_WORKER_SIGNING_SECRET = "test-worker-signing-secret";

const sourceId = "12345678-1234-1234-1234-123456789012";
const ticket = issueWorkerJobTicket({ sourceId, filename: "episode.mp4" });
const [encoded, signature] = ticket.split(".");
const claim = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));

assert.equal(claim.kind, "job");
assert.equal(claim.filename, "episode.mp4");
assert.equal(claim.sourceId, sourceId);
assert.ok(claim.expiresAt > Date.now());
assert.equal(signature, createHmac("sha256", process.env.OPENCAST_WORKER_SIGNING_SECRET).update(encoded).digest("base64url"));

const uploadTicket = issueWorkerUploadTicket({ sourceId, filename: "episode.mp4", size: 1024, contentType: "video/mp4" });
const uploadClaim = JSON.parse(Buffer.from(uploadTicket.split(".")[0], "base64url").toString("utf8"));
assert.deepEqual({ kind: uploadClaim.kind, sourceId: uploadClaim.sourceId, size: uploadClaim.size, contentType: uploadClaim.contentType }, {
  kind: "upload", sourceId, size: 1024, contentType: "video/mp4",
});

const mediaTicket = issueWorkerMediaTicket(sourceId);
const mediaClaim = JSON.parse(Buffer.from(mediaTicket.split(".")[0], "base64url").toString("utf8"));
assert.equal(mediaClaim.kind, "media");
assert.equal(mediaClaim.sourceId, sourceId);

console.log("worker ticket tests passed");
