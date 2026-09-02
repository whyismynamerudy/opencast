import { create } from "zustand";
import { getClipSegments, getCutRanges, getKeepRanges, editedDuration } from "./edits";
import { fillerWordIds, normalizeToken } from "./fillers";
import { detectSilences } from "./silences";
import type {
  AgentActivity,
  ClipSegment,
  EditorSnapshot,
  ExportRequest,
  ManualCut,
  MediaKind,
  SceneBoundary,
  Speaker,
  TimeRange,
  TranscriptMatch,
  Word,
} from "./types";

type EditorState = {
  mediaFile: File | null;
  mediaUrl: string | null;
  mediaName: string;
  mediaKind: MediaKind;
  duration: number;
  words: Word[];
  manualCuts: ManualCut[];
  sceneBoundaries: SceneBoundary[];
  speakers: Speaker[];
  selectedWordIds: string[];
  playbackTime: number;
  isPlaying: boolean;
  history: EditorSnapshot[];
  future: EditorSnapshot[];
  activity: AgentActivity[];
  exportRequest: ExportRequest;
  exportStatus: "idle" | "rendering" | "ready" | "error";
  exportError: string | null;
  setMedia: (file: File, url: string, duration: number) => void;
  loadTranscript: (words: Word[], speakers: Speaker[]) => void;
  setSelectedWordIds: (ids: string[]) => void;
  toggleSelectedWord: (id: string) => void;
  deleteWords: (ids: string[]) => number;
  restoreWords: (ids: string[]) => number;
  removeFillers: () => number;
  removeSilences: (minimum?: number) => { count: number; seconds: number };
  deletePassage: (quote: string) => { ok: boolean; message: string; match?: TranscriptMatch };
  findInTranscript: (query: string) => TranscriptMatch[];
  splitAt: (time: number) => boolean;
  trimClip: (clipIndex: number, edge: "start" | "end", toTime: number) => boolean;
  undo: () => boolean;
  redo: () => boolean;
  setPlaybackTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  addActivity: (tool: string, detail: string, status?: AgentActivity["status"]) => void;
  requestExport: (format: NonNullable<ExportRequest>["format"]) => string;
  setExportStatus: (status: EditorState["exportStatus"], error?: string | null) => void;
  clearExportRequest: () => void;
  getCutRanges: () => TimeRange[];
  getKeepRanges: () => TimeRange[];
  getClips: () => ClipSegment[];
  getProjectState: () => Record<string, unknown>;
};

const MAX_HISTORY = 80;
const SPEAKER_COLORS = ["#dd6953", "#6e9cdb", "#a477d4", "#d6a540", "#4da58a"];

function cloneSnapshot(state: Pick<EditorState, "words" | "manualCuts" | "sceneBoundaries" | "speakers">): EditorSnapshot {
  return {
    words: state.words.map((word) => ({ ...word })),
    manualCuts: state.manualCuts.map((cut) => ({ ...cut })),
    sceneBoundaries: state.sceneBoundaries.map((boundary) => ({ ...boundary })),
    speakers: state.speakers.map((speaker) => ({ ...speaker })),
  };
}

function createCut(start: number, end: number, source: ManualCut["source"]): ManualCut {
  return { id: `cut-${crypto.randomUUID()}`, start, end, source };
}

function wordText(word: Word): string {
  return normalizeToken(word.text);
}

function findMatches(words: Word[], query: string): TranscriptMatch[] {
  const queryTokens = query.split(/\s+/).map(normalizeToken).filter(Boolean);
  if (!queryTokens.length) return [];
  const usable = words.filter((word) => wordText(word));
  const matches: TranscriptMatch[] = [];

  for (let start = 0; start <= usable.length - queryTokens.length; start++) {
    const candidate = usable.slice(start, start + queryTokens.length);
    if (!candidate.every((word, index) => wordText(word) === queryTokens[index])) continue;
    const before = usable.slice(Math.max(0, start - 6), start).map((word) => word.text).join(" ");
    const after = usable.slice(start + queryTokens.length, start + queryTokens.length + 7).map((word) => word.text).join(" ");
    matches.push({
      startWordId: candidate[0].id,
      endWordId: candidate.at(-1)!.id,
      wordIds: candidate.map((word) => word.id),
      text: candidate.map((word) => word.text).join(" "),
      context: `${before}${before ? " " : ""}[${candidate.map((word) => word.text).join(" ")}]${after ? ` ${after}` : ""}`,
      start: candidate[0].start,
      end: candidate.at(-1)!.end,
    });
  }
  return matches.slice(0, 12);
}

export const useEditorStore = create<EditorState>((set, get) => {
  const commit = (next: EditorSnapshot) => {
    const current = get();
    set({
      ...next,
      history: [...current.history, cloneSnapshot(current)].slice(-MAX_HISTORY),
      future: [],
      selectedWordIds: [],
    });
  };

  return {
    mediaFile: null,
    mediaUrl: null,
    mediaName: "",
    mediaKind: "video",
    duration: 0,
    words: [],
    manualCuts: [],
    sceneBoundaries: [],
    speakers: [],
    selectedWordIds: [],
    playbackTime: 0,
    isPlaying: false,
    history: [],
    future: [],
    activity: [],
    exportRequest: null,
    exportStatus: "idle",
    exportError: null,

    setMedia: (file, url, duration) => set({
      mediaFile: file,
      mediaUrl: url,
      mediaName: file.name,
      mediaKind: file.type.startsWith("audio/") ? "audio" : "video",
      duration,
      playbackTime: 0,
      isPlaying: false,
    }),

    loadTranscript: (words, speakers) => {
      const duration = Math.max(get().duration, words.at(-1)?.end ?? 0);
      const normalizedSpeakers = speakers.length
        ? speakers
        : [{ id: 0, name: "Speaker 1", color: SPEAKER_COLORS[0] }];
      set({
        words: words.slice().sort((a, b) => a.start - b.start),
        speakers: normalizedSpeakers,
        duration,
        manualCuts: [],
        sceneBoundaries: [],
        selectedWordIds: [],
        history: [],
        future: [],
      });
    },

    setSelectedWordIds: (ids) => set({ selectedWordIds: ids }),
    toggleSelectedWord: (id) => set((state) => ({
      selectedWordIds: state.selectedWordIds.includes(id)
        ? state.selectedWordIds.filter((wordId) => wordId !== id)
        : [...state.selectedWordIds, id],
    })),

    deleteWords: (ids) => {
      const idSet = new Set(ids);
      const state = get();
      const changed = state.words.filter((word) => idSet.has(word.id) && !word.deleted).length;
      if (!changed) return 0;
      commit({ ...cloneSnapshot(state), words: state.words.map((word) => idSet.has(word.id) ? { ...word, deleted: true } : word) });
      return changed;
    },

    restoreWords: (ids) => {
      const idSet = new Set(ids);
      const state = get();
      const changed = state.words.filter((word) => idSet.has(word.id) && word.deleted).length;
      if (!changed) return 0;
      commit({ ...cloneSnapshot(state), words: state.words.map((word) => idSet.has(word.id) ? { ...word, deleted: false } : word) });
      return changed;
    },

    removeFillers: () => get().deleteWords(fillerWordIds(get().words)),

    removeSilences: (minimum) => {
      const state = get();
      const ranges = detectSilences(state.words, state.manualCuts, state.duration, minimum);
      if (!ranges.length) return { count: 0, seconds: 0 };
      commit({
        ...cloneSnapshot(state),
        manualCuts: [...state.manualCuts, ...ranges.map((range) => createCut(range.start, range.end, "silence"))],
      });
      return { count: ranges.length, seconds: ranges.reduce((sum, range) => sum + range.end - range.start, 0) };
    },

    deletePassage: (quote) => {
      const match = get().findInTranscript(quote)[0];
      if (!match) return { ok: false, message: "I couldn't find that exact passage in the transcript." };
      const changed = get().deleteWords(match.wordIds);
      return {
        ok: changed > 0,
        message: changed ? `Cut “${match.text}”.` : "That passage is already cut.",
        match,
      };
    },

    findInTranscript: (query) => findMatches(get().words, query),

    splitAt: (time) => {
      const state = get();
      const cuts = getCutRanges(state.words, state.manualCuts, state.duration);
      const valid = time > 0.04 && time < state.duration - 0.04 && !cuts.some((cut) => time >= cut.start && time <= cut.end);
      if (!valid || state.sceneBoundaries.some((boundary) => Math.abs(boundary.time - time) < 0.04)) return false;
      commit({ ...cloneSnapshot(state), sceneBoundaries: [...state.sceneBoundaries, { id: `split-${crypto.randomUUID()}`, time }] });
      return true;
    },

    trimClip: (clipIndex, edge, toTime) => {
      const state = get();
      const clips = get().getClips();
      const clip = clips[clipIndex];
      if (!clip) return false;
      const time = Math.max(clip.start, Math.min(clip.end, toTime));
      const range = edge === "start" ? { start: clip.start, end: time } : { start: time, end: clip.end };
      if (range.end - range.start < 0.02) return false;
      commit({ ...cloneSnapshot(state), manualCuts: [...state.manualCuts, createCut(range.start, range.end, "trim")] });
      return true;
    },

    undo: () => {
      const state = get();
      const previous = state.history.at(-1);
      if (!previous) return false;
      set({
        ...cloneSnapshot(previous),
        history: state.history.slice(0, -1),
        future: [cloneSnapshot(state), ...state.future].slice(0, MAX_HISTORY),
        selectedWordIds: [],
      });
      return true;
    },

    redo: () => {
      const state = get();
      const next = state.future[0];
      if (!next) return false;
      set({
        ...cloneSnapshot(next),
        history: [...state.history, cloneSnapshot(state)].slice(-MAX_HISTORY),
        future: state.future.slice(1),
        selectedWordIds: [],
      });
      return true;
    },

    setPlaybackTime: (time) => set({ playbackTime: Math.max(0, Math.min(get().duration, time)) }),
    setIsPlaying: (isPlaying) => set({ isPlaying }),

    addActivity: (tool, detail, status = "info") => set((state) => ({
      activity: [{ id: crypto.randomUUID(), tool, detail, status, at: Date.now() }, ...state.activity].slice(0, 30),
    })),

    requestExport: (format) => {
      const id = crypto.randomUUID();
      set({ exportRequest: { id, format }, exportStatus: "rendering", exportError: null });
      return id;
    },
    setExportStatus: (exportStatus, exportError = null) => set({ exportStatus, exportError }),
    clearExportRequest: () => set({ exportRequest: null }),

    getCutRanges: () => {
      const state = get();
      return getCutRanges(state.words, state.manualCuts, state.duration);
    },
    getKeepRanges: () => {
      const state = get();
      return getKeepRanges(state.getCutRanges(), state.duration);
    },
    getClips: () => {
      const state = get();
      return getClipSegments(state.getKeepRanges(), state.sceneBoundaries);
    },
    getProjectState: () => {
      const state = get();
      const cuts = state.getCutRanges();
      const duration = state.duration;
      return {
        status: state.words.length ? "ready" : state.mediaFile ? "media-loaded" : "empty",
        mediaName: state.mediaName || null,
        mediaKind: state.mediaKind,
        duration,
        editedDuration: editedDuration(cuts, duration),
        wordCount: state.words.length,
        deletedWordCount: state.words.filter((word) => word.deleted).length,
        speakers: state.speakers.map(({ id, name }) => ({ id, name })),
        clipCount: state.getClips().length,
        cutCount: cuts.length,
      };
    },
  };
});
