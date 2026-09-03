import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_INPUT_MANIFEST_VERSION,
  audioPlanForDuration,
  audioPlanForSize,
  isCurrentAudioManifest,
  labelForChunk,
  singleAudioLimitBytes,
  transcriptionSegmentSeconds,
} from "../src/mediaPlan.mjs";

test("uses one OpenAI input for compact podcast audio", () => {
  const limit = singleAudioLimitBytes();
  assert.equal(audioPlanForSize(8.6 * 1024 * 1024, limit), "single");
  assert.equal(audioPlanForSize(limit, limit), "single");
  assert.equal(audioPlanForSize(limit + 1, limit), "segmented");
});

test("segments a compact long episode by duration before OpenAI sees it", () => {
  // A 47:52 episode at 24 kbps is only around 8.6 MB, which used to bypass
  // the size-only splitter and exceed the diarization model duration limit.
  assert.equal(audioPlanForDuration(2_872.656, transcriptionSegmentSeconds()), "segmented");
  assert.equal(audioPlanForDuration(900, transcriptionSegmentSeconds()), "single");
  assert.equal(audioPlanForDuration(900.001, transcriptionSegmentSeconds()), "segmented");
});

test("keeps a bounded configured single-file limit", () => {
  assert.equal(singleAudioLimitBytes("512000"), 1024 * 1024);
  assert.equal(singleAudioLimitBytes(String(30 * 1024 * 1024)), 24 * 1024 * 1024);
  assert.equal(transcriptionSegmentSeconds("30"), 60);
  assert.equal(transcriptionSegmentSeconds("1500"), 1_200);
  assert.equal(transcriptionSegmentSeconds("900"), 900);
  assert.equal(labelForChunk(1, 1), "full recording");
  assert.equal(labelForChunk(3, 8), "3 of 8");
});

test("invalidates old audio checkpoints and accepts offset-aware v3 chunks", () => {
  const files = [
    { name: "audio-000.ogg", startSeconds: 0, durationSeconds: 900.02, bytes: 2_700_000 },
    { name: "audio-001.ogg", startSeconds: 900.02, durationSeconds: 312.61, bytes: 940_000 },
  ];
  assert.equal(isCurrentAudioManifest({ version: 2, plan: "single", files: [files[0]] }), false);
  assert.equal(isCurrentAudioManifest({ version: AUDIO_INPUT_MANIFEST_VERSION, plan: "segmented", files }), true);
  assert.equal(isCurrentAudioManifest({ version: AUDIO_INPUT_MANIFEST_VERSION, plan: "single", files }), false);
});
