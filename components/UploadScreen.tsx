"use client";

import { useRef, useState } from "react";
import { CheckCircle2, CloudUpload, Film, FolderOpen, LoaderCircle, LogOut } from "lucide-react";
import { useMediaSources } from "@/hooks/useMediaSources";
import { useMediaWorker } from "@/hooks/useMediaWorker";
import { sourceProgress, sourceStatusLabel } from "@/lib/mediaStatus";
import { useEditorStore } from "@/lib/store";

type UploadScreenProps = {
  onOpenProjects?: () => void;
  onSignOut?: () => void;
};

export function UploadScreen({ onOpenProjects, onSignOut }: UploadScreenProps) {
  const mediaInput = useRef<HTMLInputElement>(null);
  const sources = useEditorStore((state) => state.mediaSources);
  const sourceUploadRequest = useEditorStore((state) => state.sourceUploadRequest);
  const clearSourceUploadRequest = useEditorStore((state) => state.clearSourceUploadRequest);
  const transcription = useEditorStore((state) => state.transcription);
  const { importFiles, importing } = useMediaSources();
  const { processLargeSource } = useMediaWorker();
  const [error, setError] = useState<string | null>(null);

  const loadMedia = async (files: File[]) => {
    setError(null);
    try {
      const imported = await importFiles(files, sourceUploadRequest?.roles);
      clearSourceUploadRequest();
      if (!imported.length) throw new Error("Choose at least one audio or video recording.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Media import failed.");
    }
  };

  const activeSources = sources.filter((source) => source.status === "uploading" || source.status === "uploaded" || source.status === "transcribing");
  const allSourcesReady = sources.length > 0 && sources.every((source) => source.status === "ready");
  const overallProgress = sources.length
    ? Math.round(sources.reduce((total, source) => total + sourceProgress(source), 0) / sources.length * 100)
    : 0;

  return (
    <main className="welcome-shell">
      <section className="welcome-card">
        {(onOpenProjects || onSignOut) && <div className="welcome-project-nav">
          {onOpenProjects && <button type="button" onClick={onOpenProjects}><FolderOpen size={14} /> All projects</button>}
          {onSignOut && <button type="button" onClick={onSignOut}><LogOut size={14} /> Sign out</button>}
        </div>}
        <div className="brand-lockup"><span className="brand-mark">◒</span><span>OpenCast</span></div>
        <p className="eyebrow">Ingest</p>
        <h1>Start with the recordings.</h1>
        <p className="welcome-copy">One take or every angle. Processing starts on its own.</p>

        <div className="upload-grid media-only">
          <button className="upload-card" onClick={() => mediaInput.current?.click()} type="button" disabled={importing}>
            {importing ? <LoaderCircle className="spin" /> : <CloudUpload />}
            <span>{sources.length ? "Add more recordings" : "Choose audio or video files"}</span>
            <small>MP4 · MOV · WebM · MP3 · M4A · WAV</small>
          </button>
        </div>

        {sourceUploadRequest && <p className="upload-request"><Film size={15} /> Upload slots are ready for {sourceUploadRequest.roles.join(", ")} — choose the matching local files.</p>}

        {sources.length > 0 && (
          <section className="processing-queue" aria-live="polite">
            <header>
              <div>
                <p className="panel-kicker">Preparing</p>
                <h2>{allSourcesReady ? "Ready to edit." : "Building your workspace."}</h2>
              </div>
              {allSourcesReady ? <CheckCircle2 size={20} /> : <LoaderCircle className="spin" size={20} />}
            </header>
            <p>{allSourcesReady ? "Transcript and speakers are ready." : activeSources.length > 1 ? "Uploading and transcribing in the background. Your editor opens with the first source." : "Uploading and transcribing. Keep this tab open."}</p>
            <div className="processing-progress" role="progressbar" aria-label="Overall media processing progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overallProgress}><span style={{ width: `${overallProgress}%` }} /></div>
            <div className="source-ingest-list">
              {sources.map((source) => (
                <div className={`source-ingest-row ${source.status}`} key={source.id}>
                  <Film size={15} />
                  <span>
                    <strong>{source.name}</strong>
                    <small>{source.role} · {Math.round(source.duration)}s · {sourceStatusLabel(source)}</small>
                    <i className="source-row-progress" aria-hidden="true"><b style={{ width: `${Math.round(sourceProgress(source) * 100)}%` }} /></i>
                  </span>
                  {source.status === "error" && source.storageUrl && <button type="button" onClick={() => void processLargeSource(source.id)}>Retry</button>}
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="media-upload-note">Direct-to-storage uploads · automatic transcription</p>
        {transcription.stage === "error" && (
          <div className={`transcription-progress ${transcription.stage === "error" ? "error" : ""}`}>
            <div className="transcription-progress-icon"><CloudUpload size={18} /></div>
            <div>
              <strong>Transcription needs attention</strong>
              <span>{transcription.error}</span>
            </div>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <input ref={mediaInput} className="sr-only" type="file" multiple accept="audio/*,video/*" onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.currentTarget.value = "";
          if (files.length) void loadMedia(files);
        }} />
      </section>
      <p className="welcome-footnote">Source-aware timing · cloud transcription</p>
    </main>
  );
}
