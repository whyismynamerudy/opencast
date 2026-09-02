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

export type Speaker = {
  id: number;
  name: string;
  color: string;
};

export type EditorSnapshot = {
  words: Word[];
  manualCuts: ManualCut[];
  sceneBoundaries: SceneBoundary[];
  speakers: Speaker[];
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
  format: "mp4" | "mp3" | "srt";
} | null;
