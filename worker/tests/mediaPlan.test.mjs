import assert from "node:assert/strict";
import test from "node:test";
import { audioPlanForSize, labelForChunk, singleAudioLimitBytes } from "../src/mediaPlan.mjs";

test("uses one OpenAI input for compact podcast audio", () => {
  const limit = singleAudioLimitBytes();
  assert.equal(audioPlanForSize(8.6 * 1024 * 1024, limit), "single");
  assert.equal(audioPlanForSize(limit, limit), "single");
  assert.equal(audioPlanForSize(limit + 1, limit), "segmented");
});

test("keeps a bounded configured single-file limit", () => {
  assert.equal(singleAudioLimitBytes("512000"), 1024 * 1024);
  assert.equal(singleAudioLimitBytes(String(30 * 1024 * 1024)), 24 * 1024 * 1024);
  assert.equal(labelForChunk(1, 1), "full recording");
  assert.equal(labelForChunk(3, 8), "3 of 8");
});
