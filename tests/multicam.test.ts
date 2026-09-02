import assert from "node:assert/strict";
import {
  applyProgramCut,
  makeSourceWord,
  masterToSourceTime,
  projectDuration,
  remapSourceWords,
  sourceToMasterTime,
  type MediaSource,
} from "../lib/multicam";
import { useEditorStore } from "../lib/store";

function run() {
  assert.equal(sourceToMasterTime(12.5, 1.25), 13.75);
  assert.equal(masterToSourceTime(13.75, 1.25), 12.5);
  assert.equal(masterToSourceTime(1, 3), 0, "a source cannot seek before its own first frame");

  const word = makeSourceWord({ id: "w1", text: "Hello", start: 8, end: 8.5, speaker: 0, deleted: false }, "guest", 2);
  assert.deepEqual({ start: word.start, end: word.end, sourceStart: word.sourceStart, sourceEnd: word.sourceEnd }, { start: 10, end: 10.5, sourceStart: 8, sourceEnd: 8.5 });
  const remapped = remapSourceWords([word], "guest", -1)[0];
  assert.deepEqual({ start: remapped.start, end: remapped.end, sourceStart: remapped.sourceStart }, { start: 7, end: 7.5, sourceStart: 8 });

  const firstCut = applyProgramCut(
    [{ id: "host-all", sourceId: "host", start: 0, end: 30 }],
    { sourceId: "guest", start: 8, end: 18 },
    (() => { let count = 0; return () => `cut-${++count}`; })(),
  );
  assert.deepEqual(firstCut.map(({ sourceId, start, end }) => ({ sourceId, start, end })), [
    { sourceId: "host", start: 0, end: 8 },
    { sourceId: "guest", start: 8, end: 18 },
    { sourceId: "host", start: 18, end: 30 },
  ]);

  const sources = [
    { id: "host", name: "host.mp4", role: "host", kind: "video", duration: 61, syncOffset: 0, status: "ready", uploadProgress: 1, file: null, localUrl: null, storageUrl: null, storagePath: null, ingestJobId: null, error: null },
    { id: "guest", name: "guest.mp4", role: "guest", kind: "video", duration: 60, syncOffset: 2, status: "ready", uploadProgress: 1, file: null, localUrl: null, storageUrl: null, storagePath: null, ingestJobId: null, error: null },
  ] satisfies MediaSource[];
  assert.equal(projectDuration(sources, [word]), 62, "project duration includes a source's sync offset");

  const sourceId = useEditorStore.getState().addMediaSource({
    name: "guest-angle.mp4",
    role: "guest",
    kind: "video",
    duration: 30,
    file: null,
    localUrl: null,
  });
  useEditorStore.getState().setSourceSyncOffset(sourceId, 1.5);
  useEditorStore.getState().loadSourceTranscript(sourceId, [
    { id: "guest-word", text: "Synced", start: 4, end: 4.4, speaker: 0, deleted: false },
  ], [{ id: 0, name: "Guest", color: "#6e9cdb" }]);
  const storedWord = useEditorStore.getState().words[0];
  assert.deepEqual(
    { sourceId: storedWord.sourceId, sourceStart: storedWord.sourceStart, start: storedWord.start, end: storedWord.end },
    { sourceId, sourceStart: 4, start: 5.5, end: 5.9 },
    "store maps a source transcript onto the master clock",
  );
  assert.equal(useEditorStore.getState().mediaSources[0].status, "ready");
  assert.match(
    useEditorStore.getState().applyProgramCut(sourceId, 0, 1).message,
    /does not cover/,
    "a program cut cannot select a source before its synced first frame",
  );

  console.log("Multicam timing and program-cut tests passed.");
}

run();
