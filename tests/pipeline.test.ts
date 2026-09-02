import assert from "node:assert/strict";
import { normalizeHostedTranscription } from "../lib/hostedTranscription";

const hosted = normalizeHostedTranscription(
  [
    { word: "Hello", start: 0, end: 0.4 },
    { word: "there", start: 0.4, end: 0.9 },
    { word: "friend", start: 1.0, end: 1.5 },
  ],
  [
    { speaker: "A", text: "Hello there", start: 0, end: 0.9 },
    { speaker: "guest", text: "friend", start: 1, end: 1.5 },
  ],
  1.5,
);
assert.equal(hosted.words.length, 3);
assert.equal(hosted.speakers.map((speaker) => speaker.name).join(","), "Speaker A,Guest");
assert.deepEqual(hosted.words.map((word) => word.speaker), [0, 0, 1]);
assert.equal(hosted.speakerTurns.length, 2);

console.log("Media pipeline utilities smoke test passed.");
