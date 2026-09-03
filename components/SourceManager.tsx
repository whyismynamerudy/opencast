"use client";

import { useRef } from "react";
import { Camera, Check, CloudUpload, Film, Plus, Scissors, SlidersHorizontal } from "lucide-react";
import { useMediaSources } from "@/hooks/useMediaSources";
import { useMediaWorker } from "@/hooks/useMediaWorker";
import { sourceProgress, sourceStatusLabel } from "@/lib/mediaStatus";
import { programSegmentAt, SOURCE_ROLES, type SourceRole } from "@/lib/multicam";
import { useEditorStore } from "@/lib/store";
import { formatTime } from "./MediaPreview";

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
  const { importFiles, importing, resumeSource } = useMediaSources();
  const { processLargeSource } = useMediaWorker();

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
      <p className="source-manager-copy">Select an angle to preview it. Sync (s) shifts a source later on the master clock.</p>
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
            <footer><span><CloudUpload size={12} /> {sourceStatusLabel(source)}</span>
              {source.status === "local" && source.file && <button type="button" onClick={() => void resumeSource(source.id)}>Resume upload</button>}
              {source.status === "error" && source.storagePath && <button type="button" onClick={() => void processLargeSource(source.id)}>Retry</button>}
            </footer>
            {(source.status === "uploading" || source.status === "uploaded" || source.status === "transcribing") && <div className="source-card-progress" aria-hidden="true"><span style={{ width: `${Math.round(sourceProgress(source) * 100)}%` }} /></div>}
          </article>
        ))}
      </div>
      {active && <button type="button" className="program-cut-button" onClick={useCurrentAngle} disabled={programEnd - playbackTime < 0.04}><Scissors size={14} /> Cut to {active.role} from {formatTime(playbackTime)}</button>}
      {sourceUploadRequest && <p className="source-agent-request"><SlidersHorizontal size={14} /> Upload slots ready for {sourceUploadRequest.roles.join(", ")} — use + to choose the files.</p>}
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
