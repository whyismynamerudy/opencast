import type { MediaKind, Word } from "./types";

export const SOURCE_ROLES = ["host", "guest", "screen", "b-roll", "other"] as const;

export type SourceRole = (typeof SOURCE_ROLES)[number];
export type SourceUploadStatus =
  | "local"
  | "uploading"
  | "uploaded"
  | "transcribing"
  | "ready"
  | "needs-worker"
  | "error";

/**
 * A source is one independently recorded angle or audio track. Timestamps in a
 * source are always native to that file; the project timeline is the master
 * clock. `syncOffset` converts between the two clocks.
 */
export type MediaSource = {
  id: string;
  name: string;
  role: SourceRole;
  kind: MediaKind;
  duration: number;
  syncOffset: number;
  status: SourceUploadStatus;
  uploadProgress: number;
  /** Worker-side progress after the original has reached project storage. */
  processingProgress?: number;
  processingStage?: string | null;
  /** Used to safely recognize an interrupted source when the user selects it again. */
  fileSize: number;
  file: File | null;
  localUrl: string | null;
  /** Stable source key for the original stored on the Fly media volume. */
  storagePath: string | null;
  ingestJobId: string | null;
  error: string | null;
};

/** A selected angle over a master-timeline range. */
export type ProgramSegment = {
  id: string;
  sourceId: string;
  start: number;
  end: number;
};

export type SourceUploadRequest = {
  id: string;
  roles: SourceRole[];
  createdAt: number;
} | null;

export type SourceWord = Word & {
  sourceId?: string;
  sourceStart?: number;
  sourceEnd?: number;
};

export function sourceToMasterTime(sourceTime: number, syncOffset = 0): number {
  return Math.max(0, sourceTime + syncOffset);
}

export function masterToSourceTime(masterTime: number, syncOffset = 0): number {
  return Math.max(0, masterTime - syncOffset);
}

export function makeSourceWord(word: Word, sourceId: string, syncOffset: number): SourceWord {
  return {
    ...word,
    id: `${sourceId}:${word.id}`,
    sourceId,
    sourceStart: word.start,
    sourceEnd: word.end,
    start: sourceToMasterTime(word.start, syncOffset),
    end: sourceToMasterTime(word.end, syncOffset),
  };
}

export function remapSourceWords(words: SourceWord[], sourceId: string, syncOffset: number): SourceWord[] {
  return words.map((word) => {
    if (word.sourceId !== sourceId) return word;
    const start = word.sourceStart ?? masterToSourceTime(word.start, syncOffset);
    const end = word.sourceEnd ?? masterToSourceTime(word.end, syncOffset);
    return {
      ...word,
      sourceStart: start,
      sourceEnd: end,
      start: sourceToMasterTime(start, syncOffset),
      end: sourceToMasterTime(end, syncOffset),
    };
  });
}

export function sourceForTime(sources: MediaSource[], sourceId: string, masterTime: number): boolean {
  const source = sources.find((item) => item.id === sourceId);
  if (!source) return false;
  const time = masterTime - source.syncOffset;
  return time >= 0 && time <= source.duration;
}

/**
 * Replace a range of the program with one source angle while retaining the
 * before/after pieces of any overlapping existing angle selections.
 */
export function applyProgramCut(
  current: ProgramSegment[],
  next: Omit<ProgramSegment, "id">,
  makeId: () => string,
): ProgramSegment[] {
  if (!Number.isFinite(next.start) || !Number.isFinite(next.end) || next.end - next.start < 0.04) return current;
  const retained: ProgramSegment[] = [];
  for (const segment of current) {
    if (segment.end <= next.start || segment.start >= next.end) {
      retained.push(segment);
      continue;
    }
    if (segment.start < next.start) retained.push({ ...segment, end: next.start });
    if (segment.end > next.end) retained.push({ ...segment, id: makeId(), start: next.end });
  }
  retained.push({ ...next, id: makeId() });
  return retained
    .filter((segment) => segment.end - segment.start >= 0.04)
    .sort((a, b) => a.start - b.start);
}

export function programSegmentAt(segments: ProgramSegment[], time: number): ProgramSegment | undefined {
  return segments.find((segment) => time >= segment.start && time < segment.end);
}

export function projectDuration(sources: MediaSource[], words: SourceWord[]): number {
  const sourceDuration = sources.reduce(
    (latest, source) => Math.max(latest, sourceToMasterTime(source.duration, source.syncOffset)),
    0,
  );
  return Math.max(sourceDuration, words.reduce((latest, word) => Math.max(latest, word.end), 0));
}
