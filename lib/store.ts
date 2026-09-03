import { create } from "zustand";
import { getClipSegments, getCutRanges, getKeepRanges, editedDuration } from "./edits";
import { fillerWordIds, normalizeToken } from "./fillers";
import { detectSilences } from "./silences";
import {
  applyProgramCut,
  makeSourceWord,
  projectDuration,
  remapSourceWords,
  sourceForTime,
  type MediaSource,
  type ProgramSegment,
  type SourceRole,
  type SourceUploadRequest,
} from "./multicam";
import type {
  AgentActivity,
  ClipSegment,
  EditorSnapshot,
  ExportRequest,
  ManualCut,
  MediaKind,
  SceneBoundary,
  Speaker,
  SpeakerTurn,
  TimeRange,
  TranscriptionState,
  TranscriptMatch,
  Word,
} from "./types";

export type SavedMediaSource = Omit<MediaSource, "file" | "localUrl">;

/** JSON-safe editor state stored in the authenticated browser's project library. */
export type ProjectSnapshot = {
  version: 1;
  projectTitle: string;
  projectRevision: number;
  mediaSources: SavedMediaSource[];
  activeSourceId: string | null;
  programSegments: ProgramSegment[];
  mediaName: string;
  mediaKind: MediaKind;
  duration: number;
  words: Word[];
  manualCuts: ManualCut[];
  sceneBoundaries: SceneBoundary[];
  speakers: Speaker[];
  activity: AgentActivity[];
  transcription: TranscriptionState;
};

type EditorState = {
  projectTitle: string;
  projectRevision: number;
  mediaSources: MediaSource[];
  activeSourceId: string | null;
  programSegments: ProgramSegment[];
  sourceUploadRequest: SourceUploadRequest;
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
  transcription: TranscriptionState;
  setMedia: (file: File, url: string, duration: number) => void;
  createMulticamProject: (title?: string) => void;
  requestSourceUpload: (roles?: SourceRole[]) => SourceUploadRequest;
  clearSourceUploadRequest: () => void;
  addMediaSource: (input: Pick<MediaSource, "name" | "role" | "kind" | "duration" | "file" | "localUrl">) => string;
  updateMediaSource: (sourceId: string, update: Partial<Omit<MediaSource, "id">>) => boolean;
  setActiveSource: (sourceId: string) => boolean;
  setSourceRole: (sourceId: string, role: SourceRole) => boolean;
  setSourceSyncOffset: (sourceId: string, syncOffset: number) => boolean;
  loadSourceTranscript: (sourceId: string, words: Word[], speakers: Speaker[]) => void;
  applyProgramCut: (sourceId: string, start: number, end: number, expectedRevision?: number) => { ok: boolean; message: string; revision: number };
  loadTranscript: (words: Word[], speakers: Speaker[]) => void;
  setTranscriptionProgress: (update: Partial<Omit<TranscriptionState, "waveform" | "speakerTurns">>) => void;
  setWaveform: (waveform: number[]) => void;
  setSpeakerTurns: (turns: SpeakerTurn[]) => void;
  setSelectedWordIds: (ids: string[]) => void;
  toggleSelectedWord: (id: string) => void;
  deleteWords: (ids: string[]) => number;
  restoreWords: (ids: string[]) => number;
  correctText: (ids: string[], text: string) => boolean;
  renameSpeaker: (id: number, name: string) => boolean;
  reassignSpeaker: (ids: string[], speaker: number) => number;
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
  getProjectSnapshot: () => ProjectSnapshot;
  loadProjectSnapshot: (snapshot: ProjectSnapshot) => void;
  resetProject: (title?: string) => void;
};

const MAX_HISTORY = 80;
const SPEAKER_COLORS = ["#a8402f", "#31547d", "#5d6b2f", "#96650f", "#2f6b62"];

function initialTranscription(): TranscriptionState {
  return {
    stage: "idle",
    progress: 0,
    message: "Ready for cloud transcription.",
    error: null,
    waveform: [],
    speakerTurns: [],
  };
}

/** Create a clean, JSON-safe state for a new project. */
export function blankProjectSnapshot(title = "Untitled podcast"): ProjectSnapshot {
  return {
    version: 1,
    projectTitle: title.trim() || "Untitled podcast",
    projectRevision: 0,
    mediaSources: [],
    activeSourceId: null,
    programSegments: [],
    mediaName: "",
    mediaKind: "video",
    duration: 0,
    words: [],
    manualCuts: [],
    sceneBoundaries: [],
    speakers: [],
    activity: [],
    transcription: initialTranscription(),
  };
}

function cloneSnapshot(state: Pick<EditorState, "words" | "manualCuts" | "sceneBoundaries" | "speakers" | "programSegments">): EditorSnapshot {
  return {
    words: state.words.map((word) => ({ ...word })),
    manualCuts: state.manualCuts.map((cut) => ({ ...cut })),
    sceneBoundaries: state.sceneBoundaries.map((boundary) => ({ ...boundary })),
    speakers: state.speakers.map((speaker) => ({ ...speaker })),
    programSegments: state.programSegments.map((segment) => ({ ...segment })),
  };
}

function activeSourceFields(source: MediaSource | undefined) {
  return {
    mediaFile: source?.file ?? null,
    mediaUrl: source?.localUrl ?? source?.storageUrl ?? null,
    mediaName: source?.name ?? "",
    mediaKind: source?.kind ?? "video" as MediaKind,
  };
}

function savedSource(source: MediaSource): SavedMediaSource {
  const { file, localUrl, ...persisted } = source;
  void file;
  void localUrl;
  return { ...persisted };
}

function restoredSource(source: SavedMediaSource): MediaSource {
  return { ...source, file: null, localUrl: null };
}

function cloneProjectSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  return {
    ...snapshot,
    mediaSources: snapshot.mediaSources.map((source) => ({ ...source })),
    programSegments: snapshot.programSegments.map((segment) => ({ ...segment })),
    words: snapshot.words.map((word) => ({ ...word })),
    manualCuts: snapshot.manualCuts.map((cut) => ({ ...cut })),
    sceneBoundaries: snapshot.sceneBoundaries.map((boundary) => ({ ...boundary })),
    speakers: snapshot.speakers.map((speaker) => ({ ...speaker })),
    activity: snapshot.activity.map((item) => ({ ...item })),
    transcription: {
      ...snapshot.transcription,
      waveform: [...snapshot.transcription.waveform],
      speakerTurns: snapshot.transcription.speakerTurns.map((turn) => ({ ...turn })),
    },
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
      projectRevision: current.projectRevision + 1,
    });
  };

  return {
    projectTitle: "Untitled podcast",
    projectRevision: 0,
    mediaSources: [],
    activeSourceId: null,
    programSegments: [],
    sourceUploadRequest: null,
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
    transcription: initialTranscription(),

    setMedia: (file, url, duration) => {
      const state = get();
      const existing = state.mediaSources.find((source) => source.file === file || source.localUrl === url);
      const sourceId = existing?.id ?? crypto.randomUUID();
      const source: MediaSource = existing ?? {
        id: sourceId,
        name: file.name,
        role: "host",
        kind: file.type.startsWith("audio/") ? "audio" : "video",
        duration,
        syncOffset: 0,
        status: "local",
        uploadProgress: 0,
        processingProgress: 0,
        processingStage: null,
        file,
        localUrl: url,
        storageUrl: null,
        storagePath: null,
        ingestJobId: null,
        error: null,
      };
      const mediaSources = existing
        ? state.mediaSources.map((item) => item.id === sourceId ? { ...item, file, localUrl: url, duration } : item)
        : [...state.mediaSources, source];
      set({
        mediaSources,
        activeSourceId: sourceId,
        ...activeSourceFields({ ...source, file, localUrl: url, duration }),
        duration: Math.max(state.duration, duration),
        programSegments: state.programSegments.length ? state.programSegments : [{ id: crypto.randomUUID(), sourceId, start: 0, end: duration }],
        playbackTime: 0,
        isPlaying: false,
        projectRevision: state.projectRevision + 1,
        transcription: {
          stage: "idle",
          progress: 0,
          message: "Media loaded. Preparing cloud transcription…",
          error: null,
          waveform: [],
          speakerTurns: [],
        },
      });
    },

    createMulticamProject: (title) => set((state) => ({
      projectTitle: title?.trim() || state.projectTitle || "Untitled podcast",
      projectRevision: state.projectRevision + 1,
    })),

    requestSourceUpload: (roles = ["host", "guest"]) => {
      const request = { id: crypto.randomUUID(), roles, createdAt: Date.now() } satisfies NonNullable<SourceUploadRequest>;
      set((state) => ({ sourceUploadRequest: request, projectRevision: state.projectRevision + 1 }));
      return request;
    },

    clearSourceUploadRequest: () => set({ sourceUploadRequest: null }),

    addMediaSource: (input) => {
      const state = get();
      const id = crypto.randomUUID();
      const source: MediaSource = {
        id,
        name: input.name,
        role: input.role,
        kind: input.kind,
        duration: input.duration,
        syncOffset: 0,
        status: "local",
        uploadProgress: 0,
        processingProgress: 0,
        processingStage: null,
        file: input.file,
        localUrl: input.localUrl,
        storageUrl: null,
        storagePath: null,
        ingestJobId: null,
        error: null,
      };
      const mediaSources = [...state.mediaSources, source];
      const isFirst = !state.activeSourceId;
      set({
        mediaSources,
        ...(isFirst ? activeSourceFields(source) : {}),
        activeSourceId: isFirst ? source.id : state.activeSourceId,
        mediaName: isFirst ? source.name : state.mediaName,
        duration: projectDuration(mediaSources, state.words),
        projectTitle: state.mediaSources.length || state.projectTitle !== "Untitled podcast"
          ? state.projectTitle
          : source.name.replace(/\.[^.]+$/, ""),
        programSegments: state.programSegments.length || !source.duration
          ? state.programSegments
          : [{ id: crypto.randomUUID(), sourceId: source.id, start: 0, end: source.duration }],
        projectRevision: state.projectRevision + 1,
      });
      return id;
    },

    updateMediaSource: (sourceId, update) => {
      const state = get();
      const source = state.mediaSources.find((item) => item.id === sourceId);
      if (!source) return false;
      const nextSource = { ...source, ...update };
      const mediaSources = state.mediaSources.map((item) => item.id === sourceId ? nextSource : item);
      set({
        mediaSources,
        ...(state.activeSourceId === sourceId ? activeSourceFields(nextSource) : {}),
        duration: projectDuration(mediaSources, state.words),
        projectRevision: state.projectRevision + 1,
      });
      return true;
    },

    setActiveSource: (sourceId) => {
      const state = get();
      const source = state.mediaSources.find((item) => item.id === sourceId);
      if (!source) return false;
      set({ activeSourceId: sourceId, ...activeSourceFields(source), projectRevision: state.projectRevision + 1 });
      return true;
    },

    setSourceRole: (sourceId, role) => get().updateMediaSource(sourceId, { role }),

    setSourceSyncOffset: (sourceId, syncOffset) => {
      if (!Number.isFinite(syncOffset)) return false;
      const state = get();
      const source = state.mediaSources.find((item) => item.id === sourceId);
      if (!source) return false;
      const mediaSources = state.mediaSources.map((item) => item.id === sourceId ? { ...item, syncOffset } : item);
      const words = remapSourceWords(state.words, sourceId, syncOffset);
      set({
        mediaSources,
        words,
        duration: projectDuration(mediaSources, words),
        projectRevision: state.projectRevision + 1,
      });
      return true;
    },

    loadTranscript: (words, speakers) => {
      const current = get();
      const duration = Math.max(current.duration, words.at(-1)?.end ?? 0);
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
        programSegments: current.programSegments.length || !duration
          ? current.programSegments
          : current.activeSourceId
            ? [{ id: crypto.randomUUID(), sourceId: current.activeSourceId, start: 0, end: duration }]
            : [],
        projectRevision: current.projectRevision + 1,
        transcription: {
          ...current.transcription,
          stage: "complete",
          progress: 1,
          message: "Transcript ready.",
          error: null,
          speakerTurns: [],
        },
      });
    },

    loadSourceTranscript: (sourceId, words, speakers) => {
      const state = get();
      const source = state.mediaSources.find((item) => item.id === sourceId);
      if (!source) return;
      const takenSpeakerIds = new Set(state.speakers.map((speaker) => speaker.id));
      let nextSpeakerId = state.speakers.reduce((highest, speaker) => Math.max(highest, speaker.id), -1) + 1;
      const speakerMap = new Map<number, number>();
      const sourceSpeakers: Speaker[] = [];
      for (const detected of speakers.length ? speakers : [{ id: 0, name: "Speaker 1", color: SPEAKER_COLORS[0] }]) {
        const existing = state.speakers.find((speaker) => speaker.name === `${source.name} · ${detected.name}`);
        const id = existing?.id ?? (() => {
          while (takenSpeakerIds.has(nextSpeakerId)) nextSpeakerId++;
          takenSpeakerIds.add(nextSpeakerId);
          return nextSpeakerId++;
        })();
        speakerMap.set(detected.id, id);
        sourceSpeakers.push(existing ?? {
          id,
          name: `${source.name} · ${detected.name}`,
          color: detected.color || SPEAKER_COLORS[id % SPEAKER_COLORS.length],
        });
      }
      const sourceWords = words.map((word) => makeSourceWord({
        ...word,
        speaker: speakerMap.get(word.speaker) ?? sourceSpeakers[0].id,
      }, sourceId, source.syncOffset));
      const remaining = state.words.filter((word) => word.sourceId !== sourceId);
      const nextWords = [...remaining, ...sourceWords].sort((a, b) => a.start - b.start);
      const nextSources = state.mediaSources.map((item) => item.id === sourceId ? {
        ...item,
        status: "ready" as const,
        processingProgress: 1,
        processingStage: "complete",
        error: null,
      } : item);
      const nextDuration = projectDuration(nextSources, nextWords);
      set({
        words: nextWords,
        speakers: [...state.speakers.filter((speaker) => !speaker.name.startsWith(`${source.name} · `)), ...sourceSpeakers],
        mediaSources: nextSources,
        duration: nextDuration,
        programSegments: state.programSegments.length || !nextDuration
          ? state.programSegments
          : [{ id: crypto.randomUUID(), sourceId, start: 0, end: nextDuration }],
        selectedWordIds: [],
        history: [],
        future: [],
        projectRevision: state.projectRevision + 1,
        transcription: {
          ...state.transcription,
          stage: "complete",
          progress: 1,
          message: `${source.name} is ready in the master transcript.`,
          error: null,
          speakerTurns: [],
        },
      });
    },

    applyProgramCut: (sourceId, start, end, expectedRevision) => {
      const state = get();
      if (expectedRevision !== undefined && expectedRevision !== state.projectRevision) {
        return { ok: false, revision: state.projectRevision, message: "The project changed; read its latest state before applying this angle cut." };
      }
      if (!state.mediaSources.some((source) => source.id === sourceId)) {
        return { ok: false, revision: state.projectRevision, message: "That source is not in this project." };
      }
      if (start < 0 || end > state.duration + 0.04 || end - start < 0.04) {
        return { ok: false, revision: state.projectRevision, message: "Choose a valid master-timeline range for the angle cut." };
      }
      if (!sourceForTime(state.mediaSources, sourceId, start) || !sourceForTime(state.mediaSources, sourceId, Math.max(start, end - 0.001))) {
        return { ok: false, revision: state.projectRevision, message: "That source does not cover the entire requested master-timeline range." };
      }
      const programSegments = applyProgramCut(state.programSegments, { sourceId, start, end }, () => crypto.randomUUID());
      set({ programSegments, projectRevision: state.projectRevision + 1 });
      return { ok: true, revision: state.projectRevision + 1, message: "Updated the program angle selection." };
    },

    setTranscriptionProgress: (update) => set((state) => ({ transcription: { ...state.transcription, ...update } })),
    setWaveform: (waveform) => set((state) => ({ transcription: { ...state.transcription, waveform } })),
    setSpeakerTurns: (speakerTurns) => set((state) => ({ transcription: { ...state.transcription, speakerTurns } })),

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

    correctText: (ids, text) => {
      const normalized = text.trim();
      const state = get();
      if (!normalized || ids.length !== 1 || !state.words.some((word) => word.id === ids[0])) return false;
      commit({ ...cloneSnapshot(state), words: state.words.map((word) => word.id === ids[0] ? { ...word, text: normalized } : word) });
      return true;
    },

    renameSpeaker: (id, name) => {
      const normalized = name.trim();
      const state = get();
      if (!normalized || !state.speakers.some((speaker) => speaker.id === id)) return false;
      commit({ ...cloneSnapshot(state), speakers: state.speakers.map((speaker) => speaker.id === id ? { ...speaker, name: normalized } : speaker) });
      return true;
    },

    reassignSpeaker: (ids, speaker) => {
      const idSet = new Set(ids);
      const state = get();
      const changed = state.words.filter((word) => idSet.has(word.id) && word.speaker !== speaker).length;
      if (!changed) return 0;
      const speakers = state.speakers.some((item) => item.id === speaker)
        ? state.speakers
        : [...state.speakers, { id: speaker, name: `Speaker ${speaker + 1}`, color: SPEAKER_COLORS[speaker % SPEAKER_COLORS.length] }];
      commit({ ...cloneSnapshot(state), speakers, words: state.words.map((word) => idSet.has(word.id) ? { ...word, speaker } : word) });
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
        projectRevision: state.projectRevision + 1,
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
        projectRevision: state.projectRevision + 1,
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
        status: state.words.length ? "ready" : state.mediaSources.length ? "sources-loaded" : "empty",
        projectTitle: state.projectTitle,
        revision: state.projectRevision,
        mediaName: state.mediaName || null,
        mediaKind: state.mediaKind,
        duration,
        editedDuration: editedDuration(cuts, duration),
        wordCount: state.words.length,
        deletedWordCount: state.words.filter((word) => word.deleted).length,
        speakers: state.speakers.map(({ id, name }) => ({ id, name })),
        clipCount: state.getClips().length,
        cutCount: cuts.length,
        sourceCount: state.mediaSources.length,
        activeSourceId: state.activeSourceId,
        sources: state.mediaSources.map((source) => ({
          id: source.id,
          name: source.name,
          role: source.role,
          kind: source.kind,
          duration: source.duration,
          syncOffset: source.syncOffset,
          status: source.status,
          uploadProgress: source.uploadProgress,
          hasCloudCopy: Boolean(source.storageUrl),
          ingestJobId: source.ingestJobId,
        })),
        programSegments: state.programSegments.map((segment) => ({ ...segment })),
        transcription: {
          stage: state.transcription.stage,
          progress: state.transcription.progress,
          message: state.transcription.message,
        },
      };
    },

    getProjectSnapshot: () => {
      const state = get();
      return {
        version: 1,
        projectTitle: state.projectTitle,
        projectRevision: state.projectRevision,
        mediaSources: state.mediaSources.map(savedSource),
        activeSourceId: state.activeSourceId,
        programSegments: state.programSegments.map((segment) => ({ ...segment })),
        mediaName: state.mediaName,
        mediaKind: state.mediaKind,
        duration: state.duration,
        words: state.words.map((word) => ({ ...word })),
        manualCuts: state.manualCuts.map((cut) => ({ ...cut })),
        sceneBoundaries: state.sceneBoundaries.map((boundary) => ({ ...boundary })),
        speakers: state.speakers.map((speaker) => ({ ...speaker })),
        activity: state.activity.map((item) => ({ ...item })),
        transcription: {
          ...state.transcription,
          waveform: [...state.transcription.waveform],
          speakerTurns: state.transcription.speakerTurns.map((turn) => ({ ...turn })),
        },
      };
    },

    loadProjectSnapshot: (snapshot) => {
      const next = cloneProjectSnapshot(snapshot);
      const mediaSources = next.mediaSources.map(restoredSource);
      const activeSource = mediaSources.find((source) => source.id === next.activeSourceId) ?? mediaSources[0];
      set({
        projectTitle: next.projectTitle || "Untitled podcast",
        projectRevision: Number.isFinite(next.projectRevision) ? next.projectRevision : 0,
        mediaSources,
        activeSourceId: activeSource?.id ?? null,
        programSegments: next.programSegments,
        sourceUploadRequest: null,
        ...activeSourceFields(activeSource),
        mediaName: activeSource?.name ?? next.mediaName,
        mediaKind: activeSource?.kind ?? next.mediaKind,
        duration: next.duration,
        words: next.words,
        manualCuts: next.manualCuts,
        sceneBoundaries: next.sceneBoundaries,
        speakers: next.speakers,
        selectedWordIds: [],
        playbackTime: 0,
        isPlaying: false,
        history: [],
        future: [],
        activity: next.activity,
        exportRequest: null,
        exportStatus: "idle",
        exportError: null,
        transcription: next.transcription,
      });
    },

    resetProject: (title) => get().loadProjectSnapshot(blankProjectSnapshot(title)),
  };
});
