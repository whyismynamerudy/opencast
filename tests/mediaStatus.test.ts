import assert from "node:assert/strict";
import { sourceProgress, sourceStatusLabel, workerStageLabel } from "../lib/mediaStatus";
import type { MediaSource } from "../lib/multicam";

const source = (overrides: Partial<MediaSource>): MediaSource => ({
  id: "source-1",
  name: "episode.mp4",
  role: "host",
  kind: "video",
  duration: 60,
  syncOffset: 0,
  status: "uploading",
  uploadProgress: 0,
  file: null,
  localUrl: null,
  storageUrl: null,
  storagePath: null,
  ingestJobId: null,
  error: null,
  ...overrides,
});

assert.equal(sourceProgress(source({ status: "uploading", uploadProgress: 0.5 })), 0.125);
assert.equal(sourceProgress(source({ status: "transcribing", processingProgress: 0.5 })), 0.625);
assert.equal(sourceProgress(source({ status: "ready" })), 1);
assert.equal(workerStageLabel("extracting"), "Extracting episode audio");
assert.match(sourceStatusLabel(source({ status: "transcribing", processingProgress: 0.4, processingStage: "transcribing 1 of 6" })), /Transcribing 1 of 6/);
assert.equal(sourceStatusLabel(source({ status: "ready" })), "Transcript ready");

console.log("Media status progress tests passed.");
