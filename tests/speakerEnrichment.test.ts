import assert from "node:assert/strict";
import { blankProjectSnapshot, useEditorStore } from "../lib/store";

const sourceId = "enrich-source-0001";
const snapshot = blankProjectSnapshot("Enrichment test");
snapshot.mediaSources = [{
  id: sourceId,
  name: "episode.mp4",
  role: "host",
  kind: "video",
  duration: 6,
  syncOffset: 0,
  status: "ready",
  uploadProgress: 1,
  processingProgress: 1,
  processingStage: "complete",
  storageUrl: null,
  storagePath: sourceId,
  ingestJobId: "job-1",
  error: null,
}];
snapshot.activeSourceId = sourceId;
useEditorStore.getState().loadProjectSnapshot(snapshot);

// Phase 1 — words-first payload: every word is speaker 0 with a placeholder.
const workerWords = [
  { id: "worker-0-0", text: "hello", start: 0, end: 1, speaker: 0, deleted: false },
  { id: "worker-0-1", text: "there", start: 1, end: 2, speaker: 0, deleted: false },
  { id: "worker-0-2", text: "friend", start: 2, end: 3, speaker: 0, deleted: false },
];
useEditorStore.getState().loadSourceTranscript(sourceId, workerWords, [{ id: 0, name: "Speaker 1", color: "#31547d" }]);
assert.equal(useEditorStore.getState().words.length, 3);

// The user edits before speaker labels arrive.
const editedId = `${sourceId}:worker-0-1`;
useEditorStore.getState().deleteWords([editedId]);
assert.equal(useEditorStore.getState().words.find((word) => word.id === editedId)?.deleted, true);

// Phase 2 — enrichment payload: same deterministic word ids, real speakers.
const enrichedWords = [
  { id: "worker-0-0", text: "hello", start: 0, end: 1, speaker: 0, deleted: false },
  { id: "worker-0-1", text: "there", start: 1, end: 2, speaker: 1, deleted: false },
  { id: "worker-0-2", text: "friend", start: 2, end: 3, speaker: 1, deleted: false },
];
const enrichedSpeakers = [
  { id: 0, name: "A", color: "#a8402f" },
  { id: 1, name: "B", color: "#31547d" },
];
const relabeled = useEditorStore.getState().applySourceSpeakers(sourceId, enrichedWords, enrichedSpeakers);
assert.ok(relabeled >= 2, `expected at least two relabeled words, saw ${relabeled}`);

const state = useEditorStore.getState();
const wordSpeaker = (workerId: string) => state.words.find((word) => word.id === `${sourceId}:${workerId}`)?.speaker;
assert.notEqual(wordSpeaker("worker-0-0"), wordSpeaker("worker-0-1"));
assert.equal(wordSpeaker("worker-0-1"), wordSpeaker("worker-0-2"));
// The edit made before labels arrived survives untouched.
assert.equal(state.words.find((word) => word.id === editedId)?.deleted, true);
// Detected speakers are stored with the source-composite names; the
// placeholder speaker is gone once nothing references it.
assert.ok(state.speakers.some((speaker) => speaker.name === "episode.mp4 · A"));
assert.ok(state.speakers.some((speaker) => speaker.name === "episode.mp4 · B"));
assert.ok(!state.speakers.some((speaker) => speaker.name === "episode.mp4 · Speaker 1"));
// Applying the same labels again is a no-op.
assert.equal(useEditorStore.getState().applySourceSpeakers(sourceId, enrichedWords, enrichedSpeakers), 0);

console.log("Speaker enrichment tests passed.");
