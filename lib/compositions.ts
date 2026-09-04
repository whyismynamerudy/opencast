import type { TimeRange, Word } from "./types";

/**
 * A composition is a named cut assembled from ranges of the master timeline —
 * a hook, a clip, a highlight reel — living beside the full episode in the
 * same project. Ranges reference the original media; nothing is copied, so
 * playback, preview, and export all reuse the episode's word timing.
 */
export type CompositionSegment = { id: string; start: number; end: number };
export type Composition = { id: string; title: string; segments: CompositionSegment[] };

const MIN_SEGMENT_SECONDS = 0.02;

function segmentId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `seg-${Math.random().toString(36).slice(2)}`;
}

/** Sort by start and merge touching or overlapping ranges. */
export function normalizeSegments(segments: Array<{ id?: string; start: number; end: number }>): CompositionSegment[] {
  const valid = segments
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end - segment.start >= MIN_SEGMENT_SECONDS)
    .map((segment) => ({ id: segment.id ?? segmentId(), start: Math.max(0, segment.start), end: segment.end }))
    .sort((a, b) => a.start - b.start);
  const merged: CompositionSegment[] = [];
  for (const segment of valid) {
    const last = merged.at(-1);
    if (last && segment.start <= last.end + 0.001) last.end = Math.max(last.end, segment.end);
    else merged.push({ ...segment });
  }
  return merged;
}

/** Add a range to a composition's segments. */
export function addRange(segments: CompositionSegment[], start: number, end: number): CompositionSegment[] {
  return normalizeSegments([...segments, { start, end }]);
}

/** Remove a range, splitting any segment it lands inside. */
export function subtractRange(segments: CompositionSegment[], start: number, end: number): CompositionSegment[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return segments;
  const next: Array<{ id?: string; start: number; end: number }> = [];
  for (const segment of segments) {
    if (end <= segment.start || start >= segment.end) {
      next.push(segment);
      continue;
    }
    if (start > segment.start) next.push({ start: segment.start, end: start });
    if (end < segment.end) next.push({ start: end, end: segment.end });
  }
  return normalizeSegments(next);
}

/** The playback complement: everything on the master clock outside the composition. */
export function invertSegments(segments: CompositionSegment[], duration: number): TimeRange[] {
  const gaps: TimeRange[] = [];
  let cursor = 0;
  for (const segment of normalizeSegments(segments)) {
    if (segment.start > cursor) gaps.push({ start: cursor, end: Math.min(segment.start, duration) });
    cursor = Math.max(cursor, segment.end);
  }
  if (cursor < duration) gaps.push({ start: cursor, end: duration });
  return gaps.filter((gap) => gap.end - gap.start > 0.001);
}

export function segmentsDuration(segments: CompositionSegment[]): number {
  return normalizeSegments(segments).reduce((total, segment) => total + segment.end - segment.start, 0);
}

export function wordInSegments(word: Word, segments: CompositionSegment[]): boolean {
  const midpoint = (word.start + word.end) / 2;
  return segments.some((segment) => midpoint >= segment.start && midpoint <= segment.end);
}

/** Map a master-clock time into the composition's own running clock. */
export function masterToCompositionTime(segments: CompositionSegment[], time: number): number {
  let cumulative = 0;
  for (const segment of normalizeSegments(segments)) {
    if (time < segment.start) return cumulative;
    if (time <= segment.end) return cumulative + (time - segment.start);
    cumulative += segment.end - segment.start;
  }
  return cumulative;
}

/** The span covered by a set of words, padded so word edges survive rounding. */
export function wordsToRanges(words: Word[]): TimeRange[] {
  return normalizeSegments(words.map((word) => ({ start: word.start - 0.01, end: word.end + 0.01 })))
    .map(({ start, end }) => ({ start, end }));
}
