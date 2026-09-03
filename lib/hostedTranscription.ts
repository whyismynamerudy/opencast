import { applySpeakerTurns } from "./diarization";
import type { Speaker, SpeakerTurn, Word } from "./types";

export type OpenAiDiarizedSegment = {
  start: number;
  end: number;
  text: string;
  speaker: string;
};

export type OpenAiTimedWord = {
  word: string;
  start: number;
  end: number;
};

export type HostedTranscription = {
  duration: number;
  words: Word[];
  speakers: Speaker[];
  speakerTurns: SpeakerTurn[];
};

const COLORS = ["#a8402f", "#31547d", "#5d6b2f", "#96650f", "#2f6b62", "#7a4a38"];

/**
 * Combines OpenAI's speaker-labelled segments with Whisper's word timings. The
 * models are intentionally called independently, so this keeps the editor's
 * word-level cut engine independent from either response format.
 */
export function normalizeHostedTranscription(
  timedWords: OpenAiTimedWord[],
  diarizedSegments: OpenAiDiarizedSegment[],
  duration = 0,
): HostedTranscription {
  const labelToId = new Map<string, number>();
  const speakers: Speaker[] = [];
  const speakerId = (label: string) => {
    const normalized = label.trim() || "Unknown";
    const existing = labelToId.get(normalized);
    if (existing !== undefined) return existing;
    const id = labelToId.size;
    labelToId.set(normalized, id);
    speakers.push({ id, name: displaySpeakerName(normalized), color: COLORS[id % COLORS.length] });
    return id;
  };

  const speakerTurns = diarizedSegments
    .map((segment) => ({
      start: finiteTime(segment.start),
      end: finiteTime(segment.end),
      speaker: speakerId(typeof segment.speaker === "string" ? segment.speaker : "Unknown"),
      confidence: 1,
    }))
    .filter((segment): segment is SpeakerTurn => segment.start !== null && segment.end !== null && segment.end > segment.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const words = timedWords
    .map((word) => ({ text: typeof word.word === "string" ? word.word.replace(/\s+/g, " ").trim() : "", start: finiteTime(word.start), end: finiteTime(word.end) }))
    .filter((word): word is { text: string; start: number; end: number } => Boolean(word.text) && word.start !== null && word.end !== null && word.end > word.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((word, index) => ({ id: `word-${index}`, ...word, speaker: 0, deleted: false }));

  const transcriptDuration = Math.max(
    duration,
    words.at(-1)?.end ?? 0,
    speakerTurns.at(-1)?.end ?? 0,
  );
  const fallbackSpeakers = speakers.length ? speakers : [{ id: 0, name: "Speaker 1", color: COLORS[0] }];

  return {
    duration: transcriptDuration,
    words: applySpeakerTurns(words, speakerTurns),
    speakers: fallbackSpeakers,
    speakerTurns,
  };
}

function finiteTime(value: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function displaySpeakerName(label: string): string {
  if (/^speaker\s+\d+$/i.test(label)) return label;
  if (/^[A-Z]$/.test(label)) return `Speaker ${label}`;
  return label.slice(0, 1).toUpperCase() + label.slice(1);
}
