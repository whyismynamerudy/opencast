"use client";

import { useRef, useState } from "react";
import { CheckCircle2, CloudUpload, FileText, Film, LoaderCircle, Upload } from "lucide-react";
import { useMediaSources } from "@/hooks/useMediaSources";
import { useMediaWorker } from "@/hooks/useMediaWorker";
import { sourceProgress, sourceStatusLabel } from "@/lib/mediaStatus";
import { parseTranscriptFile } from "@/lib/parseTranscript";
import { useEditorStore } from "@/lib/store";

const SAMPLE_TRANSCRIPT = `1
00:00:00,000 --> 00:00:03,400
Host: Um, welcome back to OpenCast. Today we're talking about the future of creative work.

2
00:00:04,200 --> 00:00:08,900
Guest: I think the best part is that editing can feel more like a conversation.

3
00:00:10,100 --> 00:00:14,000
Host: Uh, exactly. You can ask for the dead air and the filler words to disappear.

4
00:00:15,100 --> 00:00:19,800
Guest: The human stays in control, but the busywork becomes much lighter.`;

export function UploadScreen() {
  const mediaInput = useRef<HTMLInputElement>(null);
  const transcriptInput = useRef<HTMLInputElement>(null);
  const loadTranscript = useEditorStore((state) => state.loadTranscript);
  const addActivity = useEditorStore((state) => state.addActivity);
  const sources = useEditorStore((state) => state.mediaSources);
  const sourceUploadRequest = useEditorStore((state) => state.sourceUploadRequest);
  const clearSourceUploadRequest = useEditorStore((state) => state.clearSourceUploadRequest);
  const transcription = useEditorStore((state) => state.transcription);
  const { importFiles, importing } = useMediaSources();
  const { processLargeSource } = useMediaWorker();
  const [busy, setBusy] = useState<"transcript" | null>(null);
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

  const loadTranscriptFile = async (file: File) => {
    setBusy("transcript");
    setError(null);
    try {
      const parsed = await parseTranscriptFile(file);
      loadTranscript(parsed.words, parsed.speakers);
      addActivity("transcript_import", `Imported ${parsed.words.length} time-coded words.`, "success");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Transcript import failed.");
    } finally {
      setBusy(null);
    }
  };

  const loadSample = async () => {
    setBusy("transcript");
    setError(null);
    try {
      const { parseTranscript } = await import("@/lib/parseTranscript");
      const parsed = parseTranscript(SAMPLE_TRANSCRIPT, "opencast-demo.srt");
      loadTranscript(parsed.words, parsed.speakers);
      addActivity("demo_project", "Opened the sample transcript. Add host and guest angles when ready.", "info");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="welcome-shell">
      <section className="welcome-card">
        <div className="brand-lockup"><span className="brand-mark">◒</span><span>OpenCast</span></div>
        <p className="eyebrow">MULTICAM · WEBMCP-NATIVE POST-PRODUCTION</p>
        <h1>Build the edit from every angle.</h1>
        <p className="welcome-copy">Add the host, guest, screen share, and B-roll together. OpenCast stores the originals, prepares clean audio, transcribes each angle, and opens the editor as soon as the first transcript is ready.</p>

        <div className="upload-grid">
          <button className="upload-card" onClick={() => mediaInput.current?.click()} type="button" disabled={importing}>
            {importing ? <LoaderCircle className="spin" /> : <CloudUpload />}
            <span>{sources.length ? "Add more recordings" : "Choose podcast recordings"}</span>
            <small>Select one file or every angle at once. Processing starts automatically.</small>
          </button>
          <button className="upload-card" onClick={() => transcriptInput.current?.click()} type="button" disabled={busy !== null}>
            {busy === "transcript" ? <LoaderCircle className="spin" /> : <FileText />}
            <span>Import transcript</span>
            <small>SRT, VTT, or time-coded JSON</small>
          </button>
        </div>

        {sourceUploadRequest && <p className="upload-request"><Film size={15} /> An agent prepared slots for {sourceUploadRequest.roles.join(", ")}. Choose those local files to attach them to this live project.</p>}

        {sources.length > 0 && (
          <section className="processing-queue" aria-live="polite">
            <header>
              <div>
                <p className="panel-kicker">PREPARING YOUR EDIT</p>
                <h2>{allSourcesReady ? "Your recordings are ready." : "We’re building your editing workspace."}</h2>
              </div>
              {allSourcesReady ? <CheckCircle2 size={20} /> : <LoaderCircle className="spin" size={20} />}
            </header>
            <p>{allSourcesReady ? "OpenCast has a time-coded transcript and speaker labels ready for editing." : activeSources.length > 1 ? "Each recording uploads and transcribes in the background. You can start editing as soon as the first angle is ready." : "This happens automatically — keep this tab open while we prepare the transcript."}</p>
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

        <div className="welcome-actions">
          <button className="text-button" type="button" onClick={loadSample} disabled={busy !== null || importing}>Try the sample transcript <Upload size={14} /></button>
          <span>Large originals upload directly to project storage · all media is transcribed by the media worker</span>
        </div>
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
        <input ref={transcriptInput} className="sr-only" type="file" accept=".srt,.vtt,.json,application/json,text/vtt" onChange={(event) => event.target.files?.[0] && void loadTranscriptFile(event.target.files[0])} />
      </section>
      <p className="welcome-footnote">Direct multipart storage · source-aware transcript timing · OpenAI transcription.</p>
    </main>
  );
}
