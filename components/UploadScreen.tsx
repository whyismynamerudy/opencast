"use client";

import { useRef, useState } from "react";
import { FileText, Film, LoaderCircle, Upload } from "lucide-react";
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

function probeDuration(file: File, url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = document.createElement(file.type.startsWith("audio/") ? "audio" : "video");
    element.preload = "metadata";
    element.onloadedmetadata = () => resolve(Number.isFinite(element.duration) ? element.duration : 0);
    element.onerror = () => reject(new Error("OpenCast could not read this media file."));
    element.src = url;
  });
}

export function UploadScreen() {
  const mediaInput = useRef<HTMLInputElement>(null);
  const transcriptInput = useRef<HTMLInputElement>(null);
  const setMedia = useEditorStore((state) => state.setMedia);
  const loadTranscript = useEditorStore((state) => state.loadTranscript);
  const addActivity = useEditorStore((state) => state.addActivity);
  const [busy, setBusy] = useState<"media" | "transcript" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMedia = async (file: File) => {
    setBusy("media");
    setError(null);
    const oldUrl = useEditorStore.getState().mediaUrl;
    const url = URL.createObjectURL(file);
    try {
      const duration = await probeDuration(file, url);
      if (oldUrl?.startsWith("blob:")) URL.revokeObjectURL(oldUrl);
      setMedia(file, url, duration);
      addActivity("media_import", `Loaded ${file.name}.`, "success");
    } catch (reason) {
      URL.revokeObjectURL(url);
      setError(reason instanceof Error ? reason.message : "Media import failed.");
    } finally {
      setBusy(null);
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
      addActivity("demo_project", "Opened the sample transcript. Add matching media when ready.", "info");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="welcome-shell">
      <section className="welcome-card">
        <div className="brand-lockup"><span className="brand-mark">◒</span><span>OpenCast</span></div>
        <p className="eyebrow">WEBMCP-NATIVE POST-PRODUCTION</p>
        <h1>Edit the recording by having a conversation.</h1>
        <p className="welcome-copy">Bring a recording and its SRT, VTT, or JSON transcript. OpenCast turns every word into an editable part of the cut — ready for you or your agent co-editor.</p>

        <div className="upload-grid">
          <button className="upload-card" onClick={() => mediaInput.current?.click()} type="button">
            {busy === "media" ? <LoaderCircle className="spin" /> : <Film />}
            <span>Import media</span>
            <small>MP4, MOV, WebM, MP3, WAV…</small>
          </button>
          <button className="upload-card" onClick={() => transcriptInput.current?.click()} type="button">
            {busy === "transcript" ? <LoaderCircle className="spin" /> : <FileText />}
            <span>Import transcript</span>
            <small>SRT, VTT, or time-coded JSON</small>
          </button>
        </div>

        <div className="welcome-actions">
          <button className="text-button" type="button" onClick={loadSample} disabled={busy !== null}>Try the sample transcript <Upload size={14} /></button>
          <span>Everything stays in this browser.</span>
        </div>
        {error && <p className="form-error">{error}</p>}
        <input ref={mediaInput} className="sr-only" type="file" accept="audio/*,video/*" onChange={(event) => event.target.files?.[0] && void loadMedia(event.target.files[0])} />
        <input ref={transcriptInput} className="sr-only" type="file" accept=".srt,.vtt,.json,application/json,text/vtt" onChange={(event) => event.target.files?.[0] && void loadTranscriptFile(event.target.files[0])} />
      </section>
      <p className="welcome-footnote">Phase A · Transcript import, live editing engine, local export, and shared WebMCP tools.</p>
    </main>
  );
}
