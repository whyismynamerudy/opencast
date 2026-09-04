"use client";

import { Clapperboard, Download, FileText, Music2, Video } from "lucide-react";
import { useEditorStore } from "@/lib/store";

export function ExportDialog() {
  const requestExport = useEditorStore((state) => state.requestExport);
  const status = useEditorStore((state) => state.exportStatus);
  const error = useEditorStore((state) => state.exportError);
  const mediaKind = useEditorStore((state) => state.mediaKind);

  return (
    <div className="export-box">
      <div><p className="panel-kicker">LOCAL OUTPUT</p><h3>Export your cut</h3></div>
      <div className="export-actions">
        <button type="button" onClick={() => requestExport("webm")} disabled={status === "rendering"}><Clapperboard size={15} /> Composed</button>
        {mediaKind === "video" && <button type="button" onClick={() => requestExport("mp4")} disabled={status === "rendering"}><Video size={15} /> MP4</button>}
        <button type="button" onClick={() => requestExport("mp3")} disabled={status === "rendering"}><Music2 size={15} /> MP3</button>
        <button type="button" onClick={() => requestExport("srt")} disabled={status === "rendering"}><FileText size={15} /> SRT</button>
      </div>
      <p className={error ? "export-status error" : "export-status"}>{status === "rendering" ? <><Download className="spin" size={13} /> Rendering locally…</> : error || "Composed burns captions & layers. Renders in this browser."}</p>
    </div>
  );
}
