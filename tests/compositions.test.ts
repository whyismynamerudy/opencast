import assert from "node:assert/strict";
import { addRange, invertSegments, masterToCompositionTime, normalizeSegments, segmentsDuration, subtractRange } from "../lib/compositions";
import { blankProjectSnapshot, useEditorStore } from "../lib/store";

// ── range math ──────────────────────────────────────────────
const merged = normalizeSegments([{ start: 10, end: 20 }, { start: 18, end: 25 }, { start: 40, end: 45 }]);
assert.equal(merged.length, 2);
assert.deepEqual(merged.map(({ start, end }) => [start, end]), [[10, 25], [40, 45]]);

const added = addRange(merged, 25, 40);
assert.equal(added.length, 1);
assert.equal(segmentsDuration(added), 35);

const split = subtractRange(merged, 12, 14);
assert.deepEqual(split.map(({ start, end }) => [start, end]), [[10, 12], [14, 25], [40, 45]]);

const gaps = invertSegments(merged, 60);
assert.deepEqual(gaps.map(({ start, end }) => [start, end]), [[0, 10], [25, 40], [45, 60]]);

assert.equal(masterToCompositionTime(merged, 12), 2);
assert.equal(masterToCompositionTime(merged, 42), 17);

// ── store flow: build a clip from a selection, trim it, undo ─
const snapshot = blankProjectSnapshot("Compositions test");
snapshot.duration = 100;
snapshot.words = Array.from({ length: 50 }, (_, index) => ({
  id: `w-${index}`,
  text: index === 22 ? "um" : `word${index}`,
  start: index * 2,
  end: index * 2 + 1.6,
  speaker: 0,
  deleted: false,
}));
useEditorStore.getState().loadProjectSnapshot(snapshot);

const clip = useEditorStore.getState().createComposition("Hook", [{ start: 40, end: 50 }]);
assert.equal(useEditorStore.getState().activeCompositionId, clip.id);
assert.equal(Math.round(segmentsDuration(clip.segments)), 10);

// words 20..24 fall inside 40–50
const clipWordIds = useEditorStore.getState().words
  .filter((word) => word.start >= 40 && word.end <= 50)
  .map((word) => word.id);
assert.ok(clipWordIds.includes("w-22"));

// removing the filler trims the ranges without touching the episode words
const removedFillers = useEditorStore.getState().removeFillersFromActiveComposition();
assert.equal(removedFillers, 1);
const trimmed = useEditorStore.getState().compositions[0];
assert.ok(segmentsDuration(trimmed.segments) < 10);
assert.equal(useEditorStore.getState().words.find((word) => word.id === "w-22")?.deleted, false);

// undo restores the composition's ranges
assert.ok(useEditorStore.getState().undo());
assert.equal(Math.round(segmentsDuration(useEditorStore.getState().compositions[0].segments)), 10);

// growing and shrinking through the shared actions
const grow = useEditorStore.getState().addToComposition(clip.id, [{ start: 60, end: 65 }]);
assert.equal(Math.round(grow.seconds), 5);
const shrink = useEditorStore.getState().removeFromComposition(clip.id, [{ start: 60, end: 65 }]);
assert.equal(Math.round(shrink.seconds), 5);

// snapshot round-trip keeps compositions
const saved = useEditorStore.getState().getProjectSnapshot();
assert.equal(saved.compositions?.length, 1);
useEditorStore.getState().loadProjectSnapshot(saved);
assert.equal(useEditorStore.getState().compositions[0].title, "Hook");
assert.equal(useEditorStore.getState().activeCompositionId, null);

// deleting the composition clears it and never touches the words
assert.ok(useEditorStore.getState().deleteComposition(useEditorStore.getState().compositions[0].id));
assert.equal(useEditorStore.getState().compositions.length, 0);
assert.equal(useEditorStore.getState().words.length, 50);

console.log("Composition tests passed.");
