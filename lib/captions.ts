import type { Word } from "./types";

/** The words on screen right now: the active word with a few neighbors. */
export function captionWindow(words: Word[], time: number): { words: Word[]; activeId: string | null } {
  const spoken = words.filter((word) => !word.deleted);
  if (!spoken.length) return { words: [], activeId: null };
  let index = spoken.findIndex((word) => time >= word.start && time <= word.end);
  if (index === -1) index = spoken.findIndex((word) => word.start > time);
  if (index === -1) return { words: [], activeId: null };
  const active = time >= spoken[index].start ? spoken[index] : null;
  const from = Math.max(0, index - 3);
  const to = Math.min(spoken.length, index + 5);
  const window = spoken.slice(from, to).filter((word) => Math.abs(word.start - spoken[index].start) < 3.5);
  return { words: window, activeId: active?.id ?? null };
}
