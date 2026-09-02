import type { ClipSegment, ManualCut, SceneBoundary, TimeRange, Word } from "./types";

const EPSILON = 0.0001;
const MERGE_GAP = 0.16;

export function mergeRanges(ranges: TimeRange[], duration: number): TimeRange[] {
  const sorted = ranges
    .map(({ start, end }) => ({
      start: Math.max(0, Math.min(duration, start)),
      end: Math.max(0, Math.min(duration, end)),
    }))
    .filter((range) => range.end - range.start > EPSILON)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  return sorted.reduce<TimeRange[]>((merged, range) => {
    const last = merged.at(-1);
    if (last && range.start <= last.end + MERGE_GAP) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
    return merged;
  }, []);
}

export function wordCutRanges(words: Word[], duration: number): TimeRange[] {
  const ranges: TimeRange[] = [];
  let open: TimeRange | null = null;

  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    if (!word.deleted) {
      if (open) ranges.push(open);
      open = null;
      continue;
    }
    if (!open) open = { start: word.start, end: word.end };
    else open.end = Math.max(open.end, word.end);
  }
  if (open) ranges.push(open);
  return mergeRanges(ranges, duration);
}

export function getCutRanges(
  words: Word[],
  manualCuts: ManualCut[],
  duration: number,
): TimeRange[] {
  return mergeRanges([...wordCutRanges(words, duration), ...manualCuts], duration);
}

export function getKeepRanges(cuts: TimeRange[], duration: number): TimeRange[] {
  const keep: TimeRange[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.start > cursor + EPSILON) keep.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (duration > cursor + EPSILON) keep.push({ start: cursor, end: duration });
  return keep;
}

export function getClipSegments(
  keepRanges: TimeRange[],
  boundaries: SceneBoundary[],
): ClipSegment[] {
  const points = boundaries.map((boundary) => boundary.time).sort((a, b) => a - b);
  const clips: ClipSegment[] = [];
  for (const keep of keepRanges) {
    let start = keep.start;
    for (const point of points) {
      if (point > start + 0.04 && point < keep.end - 0.04) {
        clips.push({ id: `clip-${clips.length}-${start.toFixed(3)}`, index: clips.length, start, end: point });
        start = point;
      }
    }
    clips.push({ id: `clip-${clips.length}-${start.toFixed(3)}`, index: clips.length, start, end: keep.end });
  }
  return clips;
}

export function editedDuration(cuts: TimeRange[], duration: number): number {
  return Math.max(0, duration - cuts.reduce((total, range) => total + range.end - range.start, 0));
}

export function rangeAt(time: number, ranges: TimeRange[]): TimeRange | undefined {
  return ranges.find((range) => time >= range.start && time < range.end);
}

export function isWordCut(word: Word, cuts: TimeRange[]): boolean {
  return word.deleted || cuts.some((cut) => word.start >= cut.start - EPSILON && word.end <= cut.end + EPSILON);
}

export function originalToEdited(time: number, cuts: TimeRange[]): number {
  let removed = 0;
  for (const cut of cuts) {
    if (time >= cut.end) removed += cut.end - cut.start;
    else if (time > cut.start) removed += time - cut.start;
  }
  return Math.max(0, time - removed);
}
