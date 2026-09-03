"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, FolderOpen, LogOut, PanelRightClose, PanelRightOpen, Redo2, Undo2 } from "lucide-react";
import { getClipSegments, getCutRanges, getKeepRanges } from "@/lib/edits";
import { renderCutMedia } from "@/lib/ffmpeg";
import { downloadBlob, wordsToSrt } from "@/lib/serializeTranscript";
import { useEditorStore } from "@/lib/store";
import { AgentActivityPanel } from "./AgentActivityPanel";
import { EditPanel } from "./EditPanel";
import { ExportDialog } from "./ExportDialog";
import { MediaPreview, formatTime } from "./MediaPreview";
import { Timeline } from "./Timeline";
import { TranscriptPanel } from "./TranscriptPanel";
import { UploadScreen } from "./UploadScreen";
import { SourceManager } from "./SourceManager";

type EditorProps = {
  onOpenProjects?: () => void;
  onSignOut?: () => void;
  webMcpAvailable?: boolean;
};

export function Editor({ onOpenProjects, onSignOut, webMcpAvailable = false }: EditorProps) {
  const words = useEditorStore((state) => state.words);
  const manualCuts = useEditorStore((state) => state.manualCuts);
  const boundaries = useEditorStore((state) => state.sceneBoundaries);
  const duration = useEditorStore((state) => state.duration);
  const history = useEditorStore((state) => state.history);
  const future = useEditorStore((state) => state.future);
  const selected = useEditorStore((state) => state.selectedWordIds);
  const mediaName = useEditorStore((state) => state.mediaName);
  const projectTitle = useEditorStore((state) => state.projectTitle);
  const sourceCount = useEditorStore((state) => state.mediaSources.length);
  const exportRequest = useEditorStore((state) => state.exportRequest);
  const transcription = useEditorStore((state) => state.transcription);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const deleteWords = useEditorStore((state) => state.deleteWords);
  const [inspectorOpen, setInspectorOpen] = useState(true);

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
        if (state.mediaSources.length > 1) {
          throw new Error("Multicam MP4/MP3 rendering belongs to the media worker. The source-aware edit plan and SRT export are ready.");
        }
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

  // A local source is immediately usable for preview and timeline navigation.
  // Transcript words arrive in-place once the background worker is finished.
  if (!sourceCount) return <UploadScreen onOpenProjects={onOpenProjects} onSignOut={onSignOut} />;

  return (
    <main className={`editor-shell ${inspectorOpen ? "" : "inspector-closed"}`}>
      <header className="topbar">
        <Link className="brand-lockup" href="/" aria-label="OpenCast home"><span className="brand-mark">◒</span><span>OpenCast</span></Link>
        <div className="project-name"><span className="project-dot" />{projectTitle || mediaName || "Untitled transcript"}<small>{sourceCount > 1 ? `${sourceCount} synchronized sources` : transcription.stage === "complete" ? "cloud transcript + speakers" : "cloud project"}</small></div>
        <div className="topbar-actions">
          {onOpenProjects && <button type="button" className="toolbar-button project-library-button" title="All projects" onClick={onOpenProjects}><FolderOpen size={16} /> Projects</button>}
          <button type="button" className="toolbar-button" title="Undo" aria-label="Undo" onClick={() => undo()} disabled={!history.length}><Undo2 size={16} /></button>
          <button type="button" className="toolbar-button" title="Redo" aria-label="Redo" onClick={() => redo()} disabled={!future.length}><Redo2 size={16} /></button>
          <button type="button" className="toolbar-button inspector-toggle" title={inspectorOpen ? "Hide project details" : "Show project details"} aria-label={inspectorOpen ? "Hide project details" : "Show project details"} onClick={() => setInspectorOpen((open) => !open)}>
            {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
          <button type="button" className="export-main" onClick={() => useEditorStore.getState().requestExport("mp4")}><Download size={16} /> Export</button>
          {onSignOut && <button type="button" className="toolbar-button sign-out-editor" title="Sign out" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button>}
        </div>
      </header>

      <div className="studio-shell">
        <div className="studio-main">
          <div className="studio-workspace">
            <TranscriptPanel cuts={cuts} />
            <MediaPreview cuts={cuts} />
          </div>
          <Timeline cuts={cuts} clips={clips} words={words} />
        </div>
        <aside className="studio-inspector" aria-label="Project details">
          <div className="inspector-scroll">
          <EditPanel />
          <SourceManager />
          <ExportDialog />
          <AgentActivityPanel webMcpAvailable={webMcpAvailable} />
          <div className="project-summary"><span>{words.length} words</span><span>{sourceCount} source{sourceCount === 1 ? "" : "s"}</span><span>{formatTime(duration)} master</span><span>{formatTime(Math.max(0, duration - cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0)))} final</span></div>
          </div>
        </aside>
      </div>
    </main>
  );
}
