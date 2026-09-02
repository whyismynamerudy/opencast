"use client";

import { useRef } from "react";
import { Camera, Check, CloudUpload, Film, Plus, Scissors, SlidersHorizontal } from "lucide-react";
import { useMediaSources } from "@/hooks/useMediaSources";
import { useMediaWorker } from "@/hooks/useMediaWorker";
import { programSegmentAt, SOURCE_ROLES, type SourceRole } from "@/lib/multicam";
import { useEditorStore } from "@/lib/store";
import { useTranscriber } from "@/hooks/useTranscriber";

const DIRECT_TRANSCRIPT_MAX_BYTES = 24 * 1024 * 1024;

export function SourceManager() {
  const input = useRef<HTMLInputElement>(null);
  const sources = useEditorStore((state) => state.mediaSources);
  const activeSourceId = useEditorStore((state) => state.activeSourceId);
  const playbackTime = useEditorStore((state) => state.playbackTime);
  const duration = useEditorStore((state) => state.duration);
  const segments = useEditorStore((state) => state.programSegments);
  const sourceUploadRequest = useEditorStore((state) => state.sourceUploadRequest);
  const clearSourceUploadRequest = useEditorStore((state) => state.clearSourceUploadRequest);
  const setActiveSource = useEditorStore((state) => state.setActiveSource);
  const setSourceRole = useEditorStore((state) => state.setSourceRole);
  const setSourceSyncOffset = useEditorStore((state) => state.setSourceSyncOffset);
  const applyProgramCut = useEditorStore((state) => state.applyProgramCut);
  const addActivity = useEditorStore((state) => state.addActivity);
  const { importFiles, importing } = useMediaSources();
  const { transcribe, running } = useTranscriber();
  const { processLargeSource, runningSourceIds } = useMediaWorker();

  const active = sources.find((source) => source.id === activeSourceId);
  const currentSegment = programSegmentAt(segments, playbackTime);
  const programEnd = currentSegment?.end ?? duration;

  const useCurrentAngle = () => {
    if (!active || programEnd - playbackTime < 0.04) return;
    const response = applyProgramCut(active.id, playbackTime, programEnd);
    addActivity("program_cut", response.message, response.ok ? "success" : "error");
  };

  return (
    <section className="source-manager">
      <header className="source-manager-header">
        <div><p className="panel-kicker">SOURCES</p><h2>Angles on one clock.</h2></div>
        <button type="button" className="icon-button" onClick={() => input.current?.click()} aria-label="Add media source"><Plus size={17} /></button>
      </header>
      <p className="source-manager-copy">Positive sync moves a source later on the master timeline. Select an angle to review its transcript and preview.</p>
      <div className="source-manager-list">
        {sources.map((source) => (
          <article key={source.id} className={`source-card ${source.id === activeSourceId ? "active" : ""}`}>
            <button type="button" className="source-select" onClick={() => setActiveSource(source.id)}>
              <Camera size={15} /><span>{source.name}</span>{source.id === activeSourceId && <Check size={14} />}
            </button>
            <div className="source-fields">
              <label>Role<select value={source.role} onChange={(event) => setSourceRole(source.id, event.target.value as SourceRole)}>{SOURCE_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
              <label>Sync (s)<input aria-label={`${source.name} sync offset`} type="number" step="0.01" value={source.syncOffset} onChange={(event) => setSourceSyncOffset(source.id, Number(event.target.value))} /></label>
            </div>
            <footer><span><CloudUpload size={12} /> {source.status === "uploading" ? `${Math.round(source.uploadProgress * 100)}%` : source.status.replace("-", " ")}</span>
              {source.file && source.file.size <= DIRECT_TRANSCRIPT_MAX_BYTES && source.status !== "ready" && !running && <button type="button" onClick={() => void transcribe(source.file!, source.id)}>Transcribe</button>}
              {source.status === "needs-worker" && <button type="button" onClick={() => void processLargeSource(source.id)} disabled={runningSourceIds.includes(source.id)}>Process</button>}
            </footer>
          </article>
        ))}
      </div>
      {active && <button type="button" className="program-cut-button" onClick={useCurrentAngle} disabled={programEnd - playbackTime < 0.04}><Scissors size={14} /> Cut to {active.role} from {playbackTime.toFixed(1)}s</button>}
      {sourceUploadRequest && <p className="source-agent-request"><SlidersHorizontal size={14} /> Agent requested {sourceUploadRequest.roles.join(", ")}; use + to choose the local files.</p>}
      <input ref={input} className="sr-only" type="file" multiple accept="audio/*,video/*" onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        if (files.length) {
          clearSourceUploadRequest();
          void importFiles(files, sourceUploadRequest?.roles);
        }
      }} />
      {importing && <p className="source-uploading"><Film size={14} /> Adding source files…</p>}
    </section>
  );
}
