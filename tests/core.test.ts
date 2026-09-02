import assert from "node:assert/strict";
import { editedDuration, getCutRanges, getKeepRanges } from "../lib/edits";
import { fillerWordIds } from "../lib/fillers";
import { parseTranscript } from "../lib/parseTranscript";
import { detectSilences } from "../lib/silences";

const transcript = parseTranscript(`1
00:00:00,000 --> 00:00:02,000
Um hello world

2
00:00:03,000 --> 00:00:05,000
This is OpenCast`, "episode.srt");

assert.equal(transcript.words.length, 6);
assert.deepEqual(fillerWordIds(transcript.words), ["word-0"]);

const words = transcript.words.map((word) => word.id === "word-3" ? { ...word, deleted: true } : word);
const cuts = getCutRanges(words, [], 5);
assert.equal(cuts.length, 1);
assert.equal(getKeepRanges(cuts, 5).length, 2);
assert.ok(editedDuration(cuts, 5) < 5);
assert.ok(detectSilences(transcript.words, [], 5, 0.3).length >= 1);

console.log("Core edit-engine smoke test passed.");
