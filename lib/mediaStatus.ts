import type { MediaSource } from "@/lib/multicam";

export function workerStageLabel(stage?: string): string {
  switch (stage) {
    case "authorizing": return "Starting transcription";
    case "queued": return "Waiting for the transcription worker";
    case "downloading": return "Preparing source media";
    case "extracting": return "Extracting episode audio";
    case "finalizing": return "Building the editable transcript";
    case "complete": return "Transcript ready";
    default: return stage?.startsWith("transcribing") ? stage.replace("transcribing", "Transcribing") : "Transcribing";
  }
}

/** Composite progress reflects the user's journey: storage first, then processing. */
export function sourceProgress(source: MediaSource): number {
  if (source.status === "ready") return 1;
  if (source.status === "uploading") return Math.max(0, Math.min(0.25, source.uploadProgress * 0.25));
  if (source.status === "uploaded") return 0.25;
  if (source.status === "transcribing") return 0.25 + Math.max(0, Math.min(1, source.processingProgress ?? 0)) * 0.75;
  return 0;
}

export function sourceStatusLabel(source: MediaSource): string {
  if (source.status === "uploading") return `Uploading original · ${Math.round(source.uploadProgress * 100)}%`;
  if (source.status === "uploaded") return "Upload complete · starting transcription";
  if (source.status === "transcribing") return `${workerStageLabel(source.processingStage ?? undefined)} · ${Math.round(sourceProgress(source) * 100)}%`;
  if (source.status === "ready") return "Transcript ready";
  if (source.status === "error") return source.error || "Transcription needs attention";
  if (source.status === "needs-worker") return source.error || "Waiting for transcription";
  return "Preparing source";
}
