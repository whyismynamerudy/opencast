import { getCutRanges, isWordCut } from "./edits";
import type { ManualCut, TimeRange, Word } from "./types";

export const DEFAULT_SILENCE_THRESHOLD = 0.3;

export function detectSilences(
  words: Word[],
  manualCuts: ManualCut[],
  duration: number,
  minimum = DEFAULT_SILENCE_THRESHOLD,
): TimeRange[] {
  const currentCuts = getCutRanges(words, manualCuts, duration);
  const retained = words
    .filter((word) => !isWordCut(word, currentCuts))
    .sort((a, b) => a.start - b.start);
  const gaps: TimeRange[] = [];
  let cursor = 0;

  for (const word of retained) {
    if (word.start - cursor >= minimum) {
      gaps.push({ start: cursor === 0 ? cursor : cursor + 0.06, end: word.start - 0.06 });
    }
    cursor = Math.max(cursor, word.end);
  }
  if (duration - cursor >= minimum) gaps.push({ start: cursor + 0.06, end: duration });
  return gaps.filter((gap) => gap.end - gap.start > 0.02);
}
