import type { Word } from "./types";

const FILLERS = new Set([
  "um", "umm", "ummm", "uh", "uhh", "uhm", "erm", "er", "err", "ah", "ahh",
  "eh", "ehm", "hmm", "hmmm", "hm", "mhm", "mm", "mmm", "uh-huh", "mm-hmm",
  "euh", "äh", "ähm", "嗯", "呃",
]);

export function normalizeToken(value: string): string {
  return value.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}-]+$/gu, "");
}

export function isFiller(value: string): boolean {
  return FILLERS.has(normalizeToken(value));
}

export function fillerWordIds(words: Word[]): string[] {
  return words.filter((word) => !word.deleted && isFiller(word.text)).map((word) => word.id);
}
