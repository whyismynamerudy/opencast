"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Download, Redo2, Scissors, Undo2 } from "lucide-react";
import { getClipSegments, getCutRanges, getKeepRanges } from "@/lib/edits";
import { renderCutMedia } from "@/lib/ffmpeg";
import { downloadBlob, wordsToSrt } from "@/lib/serializeTranscript";
import { useEditorStore } from "@/lib/store";
import { useWebMCP } from "@/hooks/useWebMCP";
import { AgentActivityPanel } from "./AgentActivityPanel";
import { ExportDialog } from "./ExportDialog";
import { MediaPreview, formatTime } from "./MediaPreview";
import { Timeline } from "./Timeline";
import { TranscriptPanel } from "./TranscriptPanel";
import { UploadScreen } from "./UploadScreen";

export function Editor() {
  const words = useEditorStore((state) => state.words);
  const manualCuts = useEditorStore((state) => state.manualCuts);
  const boundaries = useEditorStore((state) => state.sceneBoundaries);
  const duration = useEditorStore((state) => state.duration);
  const history = useEditorStore((state) => state.history);
  const future = useEditorStore((state) => state.future);
  const selected = useEditorStore((state) => state.selectedWordIds);
  const mediaName = useEditorStore((state) => state.mediaName);
  const exportRequest = useEditorStore((state) => state.exportRequest);
  const transcription = useEditorStore((state) => state.transcription);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const deleteWords = useEditorStore((state) => state.deleteWords);
  const webMcpAvailable = useWebMCP();

  const cuts = useMemo(() => getCutRanges(words, manualCuts, duration), [words, manualCuts, duration]);
  const keepRanges = useMemo(() => getKeepRanges(cuts, duration), [cuts, duration]);
  const clips = useMemo(() => getClipSegments(keepRanges, boundaries), [keepRanges, boundaries]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }
      if ((event.key === "Backspace" || event.key === "Delete") && selected.length && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        deleteWords(selected);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteWords, redo, selected, undo]);

  useEffect(() => {
    if (!exportRequest) return;
    let cancelled = false;
    const exportCurrentProject = async () => {
      try {
        const state = useEditorStore.getState();
        if (exportRequest.format === "srt") {
          const blob = new Blob([wordsToSrt(state.words)], { type: "text/plain;charset=utf-8" });
          downloadBlob(blob, "opencast-edited.srt");
          state.addActivity("export", "Downloaded the edited SRT transcript.", "success");
          state.setExportStatus("ready");
          return;
        }
        if (!state.mediaFile) throw new Error("Import the source media before rendering MP4 or MP3.");
        const blob = await renderCutMedia({
          file: state.mediaFile,
          kind: state.mediaKind,
          keepRanges: state.getKeepRanges(),
          format: exportRequest.format,
        });
        if (cancelled) return;
        const extension = exportRequest.format;
        downloadBlob(blob, `opencast-edited.${extension}`);
        state.addActivity("export", `Rendered ${extension.toUpperCase()} locally from ${state.getKeepRanges().length} kept ranges.`, "success");
        state.setExportStatus("ready");
      } catch (reason) {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : "Export failed.";
        useEditorStore.getState().setExportStatus("error", message);
        useEditorStore.getState().addActivity("export", message, "error");
      } finally {
        if (!cancelled) useEditorStore.getState().clearExportRequest();
      }
    };
    void exportCurrentProject();
    return () => { cancelled = true; };
  }, [exportRequest]);

  if (!words.length) return <UploadScreen />;

  return (
    <main className="editor-shell">
      <header className="topbar">
        <Link className="brand-lockup" href="/" aria-label="OpenCast home"><span className="brand-mark">◒</span><span>OpenCast</span></Link>
        <div className="project-name"><span className="project-dot" />{mediaName || "Untitled transcript"}<small>{transcription.stage === "complete" ? "cloud transcript + speakers" : "cloud project"}</small></div>
        <div className="topbar-actions">
          <button type="button" className="toolbar-button" onClick={() => undo()} disabled={!history.length}><Undo2 size={16} /> Undo</button>
          <button type="button" className="toolbar-button" onClick={() => redo()} disabled={!future.length}><Redo2 size={16} /> Redo</button>
          <button type="button" className="export-main" onClick={() => useEditorStore.getState().requestExport("mp4")}><Download size={16} /> Export</button>
        </div>
      </header>

      <div className="editor-grid">
        <div className="workspace-main">
          <MediaPreview cuts={cuts} />
          <Timeline cuts={cuts} clips={clips} words={words} />
          <TranscriptPanel cuts={cuts} />
        </div>
        <div className="workspace-side">
          <AgentActivityPanel webMcpAvailable={webMcpAvailable} />
          <ExportDialog />
          <div className="editing-tip"><Scissors size={15} /><span><strong>Shared action hub</strong> — every UI action and WebMCP tool calls the same edit engine.</span></div>
          <div className="project-summary"><span>{words.length} words</span><span>{formatTime(duration)} original</span><span>{formatTime(Math.max(0, duration - cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0)))} final</span></div>
        </div>
      </div>
    </main>
  );
}
