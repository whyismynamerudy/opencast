import type { Word } from "./types";

export type WhisperChunk = {
  text: string;
  timestamp?: [number | null, number | null] | number[];
};

const REPEAT_LIMIT = 3;

/** Turn Whisper's word chunks into editor words, removing malformed/repeated hallucinations. */
export function wordsFromWhisperChunks(chunks: WhisperChunk[], duration: number): Word[] {
  const words: Word[] = [];
  const recent = new Map<string, number>();

  for (const chunk of chunks) {
    const raw = chunk.text.replace(/\s+/g, " ").trim();
    const start = numberAt(chunk.timestamp, 0);
    const end = numberAt(chunk.timestamp, 1);
    if (!raw || start === null || end === null || end <= start || start > duration + 0.2) continue;
    const tokens = raw.match(/\S+/g) ?? [];
    if (!tokens.length || tokens.length > 16) continue;
    const span = Math.max(0.02, end - start);
    let cursor = start;

    tokens.forEach((text, index) => {
      const normalized = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (!normalized) return;
      const lastSeen = recent.get(normalized);
      const duplicate = lastSeen !== undefined && cursor - lastSeen < 0.12;
      if (duplicate) return;
      const tokenEnd = index === tokens.length - 1 ? end : cursor + span * (text.length / raw.length);
      words.push({
        id: `word-${words.length}`,
        text,
        start: Math.max(0, cursor),
        end: Math.min(duration, Math.max(cursor + 0.02, tokenEnd)),
        speaker: 0,
        deleted: false,
      });
      recent.set(normalized, cursor);
      cursor = tokenEnd;
    });
  }

  return suppressRunawayRepeats(words);
}

function numberAt(value: WhisperChunk["timestamp"], index: number): number | null {
  const candidate = value?.[index];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function suppressRunawayRepeats(words: Word[]): Word[] {
  const kept: Word[] = [];
  let last = "";
  let count = 0;
  for (const word of words) {
    const key = word.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    count = key && key === last ? count + 1 : 1;
    last = key;
    if (count <= REPEAT_LIMIT) kept.push(word);
  }
  return kept.map((word, index) => ({ ...word, id: `word-${index}` }));
}
