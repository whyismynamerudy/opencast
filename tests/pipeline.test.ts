import assert from "node:assert/strict";
import { buildWaveformEnvelope } from "../lib/audio";
import { applySpeakerTurns, speakersFromTurns, stitchDiarizationWindows } from "../lib/diarization";
import { ctcViterbiAlign, refineWordsFromAlignment } from "../lib/forcedAlignment";
import { wordsFromWhisperChunks } from "../lib/transcriptCleanup";

const waveform = buildWaveformEnvelope(new Float32Array([0, 0.2, -0.8, 0.1, 0.4, 0]), 3);
assert.equal(waveform.length, 3);
assert.ok(Math.max(...waveform) > 0.5);

const words = wordsFromWhisperChunks([
  { text: " hello", timestamp: [0, 0.4] },
  { text: " world", timestamp: [0.4, 0.9] },
  { text: " world", timestamp: [0.45, 0.91] },
], 1);
assert.equal(words.length, 2);

const turns = stitchDiarizationWindows([
  { index: 0, frames: [{ start: 0, end: 0.1, activeSpeakers: [0], confidence: 0.9 }, { start: 0.1, end: 0.2, activeSpeakers: [0], confidence: 0.9 }] },
  { index: 1, frames: [{ start: 0.1, end: 0.2, activeSpeakers: [1], confidence: 0.8 }, { start: 0.2, end: 0.3, activeSpeakers: [1], confidence: 0.8 }] },
]);
assert.equal(turns.length, 1);
assert.equal(speakersFromTurns(turns).length, 1);
assert.equal(applySpeakerTurns(words, turns)[0].speaker, 0);

const logits = new Float32Array([
  -3, 5, -3,
  -3, 5, -3,
  5, -3, -3,
  -3, -3, 5,
]);
const alignment = ctcViterbiAlign(logits, 4, 3, [1, 2], 0);
assert.ok(alignment);
assert.deepEqual(alignment!.starts, [0, 3]);
const refined = refineWordsFromAlignment(words, [0, 1], alignment!, 1, 4);
assert.ok(refined[0].end <= refined[1].start);

console.log("On-device pipeline utilities smoke test passed.");
