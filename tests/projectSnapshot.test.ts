import assert from "node:assert/strict";
import { blankProjectSnapshot, useEditorStore } from "../lib/store";

const sourceId = "saved-source";
const snapshot = blankProjectSnapshot("Episode archive");
snapshot.mediaSources = [{
  id: sourceId,
  name: "episode.mp4",
  role: "host",
  kind: "video",
  duration: 42,
  syncOffset: 0,
  status: "ready",
  uploadProgress: 1,
  processingProgress: 1,
  processingStage: "complete",
  storageUrl: "https://store.public.blob.vercel-storage.com/episode.mp4",
  storagePath: "opencast/saved-source/episode.mp4",
  ingestJobId: "complete-job",
  error: null,
}];
snapshot.activeSourceId = sourceId;
snapshot.duration = 42;
snapshot.words = [{ id: "word-1", text: "Welcome", start: 0, end: 0.5, speaker: 0, deleted: false, sourceId }];
snapshot.speakers = [{ id: 0, name: "Host", color: "#6e9cdb" }];

useEditorStore.getState().loadProjectSnapshot(snapshot);
const restored = useEditorStore.getState();
assert.equal(restored.projectTitle, "Episode archive");
assert.equal(restored.mediaSources[0].file, null);
assert.equal(restored.mediaSources[0].localUrl, null);
assert.equal(restored.mediaUrl, "https://store.public.blob.vercel-storage.com/episode.mp4");
assert.equal(restored.words[0].text, "Welcome");

const savedAgain = restored.getProjectSnapshot();
assert.equal(savedAgain.mediaSources[0].storageUrl, "https://store.public.blob.vercel-storage.com/episode.mp4");
assert.equal("file" in savedAgain.mediaSources[0], false);
assert.equal("localUrl" in savedAgain.mediaSources[0], false);

console.log("Project snapshot persistence tests passed.");
