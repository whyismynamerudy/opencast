"use client";

import { useRef, useState } from "react";
import { CloudUpload, FileText, Film, LoaderCircle, Mic2, Upload, X } from "lucide-react";
import { useMediaSources } from "@/hooks/useMediaSources";
import { useMediaWorker } from "@/hooks/useMediaWorker";
import { parseTranscriptFile } from "@/lib/parseTranscript";
import { useEditorStore } from "@/lib/store";
import { useTranscriber } from "@/hooks/useTranscriber";

const DIRECT_TRANSCRIPT_MAX_BYTES = 24 * 1024 * 1024;

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
  const { transcribe, cancel, running } = useTranscriber();
  const { processLargeSource, runningSourceIds } = useMediaWorker();
  const [busy, setBusy] = useState<"transcript" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMedia = async (files: File[]) => {
    setError(null);
    try {
      const imported = await importFiles(files, sourceUploadRequest?.roles);
      clearSourceUploadRequest();
      if (imported.length === 1 && imported[0].file.size <= DIRECT_TRANSCRIPT_MAX_BYTES) {
        void transcribe(imported[0].file, imported[0].sourceId);
      } else {
        for (const item of imported.filter(({ file }) => file.size > DIRECT_TRANSCRIPT_MAX_BYTES)) {
          const source = useEditorStore.getState().mediaSources.find((candidate) => candidate.id === item.sourceId);
          if (source?.storageUrl) {
            useEditorStore.getState().updateMediaSource(item.sourceId, {
              status: "needs-worker",
              error: "Large-source transcription is handled by the media worker after direct upload.",
            });
          }
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Media import failed.");
    }
  };

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
        <p className="welcome-copy">Add the host, guest, screen share, and B-roll together. OpenCast keeps each file on its own clock, maps transcripts to a shared master timeline, and lets a person or agent choose the program angle without guessing through the interface.</p>

        <div className="upload-grid">
          <button className="upload-card" onClick={() => mediaInput.current?.click()} type="button" disabled={importing}>
            {importing ? <LoaderCircle className="spin" /> : <CloudUpload />}
            <span>{sources.length ? "Add media sources" : "Import media sources"}</span>
            <small>Choose multiple MP4, WebM, MP3, M4A, WAV…</small>
          </button>
          <button className="upload-card" onClick={() => transcriptInput.current?.click()} type="button" disabled={busy !== null}>
            {busy === "transcript" ? <LoaderCircle className="spin" /> : <FileText />}
            <span>Import transcript</span>
            <small>SRT, VTT, or time-coded JSON</small>
          </button>
        </div>

        {sourceUploadRequest && <p className="upload-request"><Film size={15} /> An agent prepared slots for {sourceUploadRequest.roles.join(", ")}. Choose those local files to attach them to this live project.</p>}

        {sources.length > 0 && (
          <div className="source-ingest-list">
            {sources.map((source) => (
              <div className="source-ingest-row" key={source.id}>
                <Film size={15} />
                <span><strong>{source.name}</strong><small>{source.role} · {Math.round(source.duration)}s · {source.status === "uploading" ? `${Math.round(source.uploadProgress * 100)}% uploaded` : source.status.replace("-", " ")}</small></span>
                {source.file && source.file.size <= DIRECT_TRANSCRIPT_MAX_BYTES && source.status !== "ready" && !running && <button type="button" onClick={() => void transcribe(source.file!, source.id)}>Transcribe</button>}
                {source.status === "needs-worker" && <button type="button" onClick={() => void processLargeSource(source.id)} disabled={runningSourceIds.includes(source.id)}>Process</button>}
              </div>
            ))}
          </div>
        )}

        <div className="welcome-actions">
          <button className="text-button" type="button" onClick={loadSample} disabled={busy !== null || importing}>Try the sample transcript <Upload size={14} /></button>
          <span>Large originals upload directly to project storage · small local clips can transcribe now</span>
        </div>
        {(running || transcription.stage === "error" || transcription.stage === "extracting") && (
          <div className={`transcription-progress ${transcription.stage === "error" ? "error" : ""}`}>
            <div className="transcription-progress-icon">{running ? <LoaderCircle className="spin" size={18} /> : <Mic2 size={18} />}</div>
            <div>
              <strong>{transcription.stage === "error" ? "Cloud transcription needs attention" : transcription.message}</strong>
              <span>{transcription.stage === "error" ? transcription.error : `${Math.round(transcription.progress * 100)}% · OpenAI diarization + word timing`}</span>
            </div>
            {running ? <button type="button" className="progress-action" onClick={cancel} aria-label="Cancel transcription"><X size={15} /></button> : null}
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
