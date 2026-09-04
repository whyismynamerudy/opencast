export type MediaKind = "video" | "audio";

export type TimeRange = {
  start: number;
  end: number;
};

export type Word = {
  id: string;
  text: string;
  start: number;
  end: number;
  speaker: number;
  deleted: boolean;
  /** Present when a word originated in an independently recorded source. */
  sourceId?: string;
  /** Native time in that source; start/end remain on the master timeline. */
  sourceStart?: number;
  sourceEnd?: number;
};

export type ManualCut = TimeRange & {
  id: string;
  source: "silence" | "trim" | "manual";
};

export type SceneBoundary = {
  id: string;
  time: number;
};

export type ClipSegment = TimeRange & {
  id: string;
  index: number;
};

/**
 * A timed image placed on the preview. `under` sits behind the footage (a
 * background layer); `over` covers it (a B-roll style insert). Captions and
 * transport controls always render above both.
 */
export type OverlayLayer = "under" | "over";
export type ImageOverlay = {
  id: string;
  kind: "image";
  name: string;
  url: string;
  start: number;
  end: number;
  layer: OverlayLayer;
};

export type Speaker = {
  id: number;
  name: string;
  color: string;
};

export type SpeakerTurn = TimeRange & {
  speaker: number;
  confidence: number;
};

export type TranscriptionStage =
  | "idle"
  | "extracting"
  | "voice_activity"
  | "transcribing"
  | "aligning"
  | "diarizing"
  | "finalizing"
  | "complete"
  | "error";

export type TranscriptionState = {
  stage: TranscriptionStage;
  progress: number;
  message: string;
  error: string | null;
  waveform: number[];
  speakerTurns: SpeakerTurn[];
};

export type EditorSnapshot = {
  words: Word[];
  manualCuts: ManualCut[];
  sceneBoundaries: SceneBoundary[];
  speakers: Speaker[];
  programSegments: import("./multicam").ProgramSegment[];
  compositions: import("./compositions").Composition[];
};

export type TranscriptMatch = {
  startWordId: string;
  endWordId: string;
  wordIds: string[];
  text: string;
  context: string;
  start: number;
  end: number;
};

export type AgentActivity = {
  id: string;
  tool: string;
  detail: string;
  status: "success" | "error" | "info";
  at: number;
};

export type ExportRequest = {
  id: string;
  format: "mp4" | "mp3" | "srt" | "webm";
} | null;
