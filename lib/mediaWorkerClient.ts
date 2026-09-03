"use client";

import { useEditorStore } from "@/lib/store";
import type { Speaker, SpeakerTurn, Word } from "@/lib/types";
import { workerStageLabel } from "@/lib/mediaStatus";

type WorkerJobStatus = {
  status: "queued" | "processing" | "complete" | "error";
  stage?: string;
  progress?: number;
  error?: string;
  result?: { words: Word[]; speakers: Speaker[]; speakerTurns: SpeakerTurn[] };
};

type QueueResult = { ok: true; jobId: string } | { ok: false; error: string };

const POLL_INTERVAL_MS = 2_000;
const activePolls = new Set<string>();

function workerUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL?.replace(/\/$/, "");
  return value || null;
}

function setWorkerProgress(sourceId: string, progress: number, stage: string) {
  const editor = useEditorStore.getState();
  const source = editor.mediaSources.find((item) => item.id === sourceId);
  if (!source) return;
  const normalizedProgress = Math.max(0, Math.min(1, progress));
  editor.updateMediaSource(sourceId, {
    status: "transcribing",
    processingProgress: normalizedProgress,
    processingStage: stage,
    error: null,
  });
  editor.setTranscriptionProgress({
    stage: "transcribing",
    progress: normalizedProgress,
    message: `${source.name} · ${workerStageLabel(stage)}`,
    error: null,
  });
}

function failWorkerSource(sourceId: string, reason: unknown): QueueResult {
  const message = reason instanceof Error ? reason.message : "Media worker could not process this source.";
  const editor = useEditorStore.getState();
  const source = editor.mediaSources.find((item) => item.id === sourceId);
  editor.updateMediaSource(sourceId, { status: "error", processingStage: "error", error: message });
  editor.setTranscriptionProgress({
    stage: "error",
    progress: 0,
    message: source ? `${source.name} needs attention.` : "Transcription needs attention.",
    error: message,
  });
  editor.addActivity("media_worker", message, "error");
  return { ok: false, error: message };
}

async function issueWorkerTicket(source: { storageUrl: string | null; id: string; name: string }) {
  if (!source.storageUrl) throw new Error("Wait for direct media storage to finish before transcription starts.");
  const ticketResponse = await fetch("/api/media/worker-ticket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceUrl: source.storageUrl, sourceId: source.id, filename: source.name }),
  });
  const ticketPayload = await ticketResponse.json() as { ticket?: string; error?: string };
  if (!ticketResponse.ok || !ticketPayload.ticket) throw new Error(ticketPayload.error || "Could not authorize the media worker job.");
  return ticketPayload.ticket;
}

function pollWorkerJob(baseUrl: string, sourceId: string, jobId: string) {
  if (activePolls.has(jobId) || typeof window === "undefined") return;
  activePolls.add(jobId);

  const check = async () => {
    try {
      const response = await fetch(`${baseUrl}/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const payload = await response.json() as WorkerJobStatus;
      if (!response.ok) throw new Error(payload.error || "Media worker status is unavailable.");
      if (payload.status === "complete" && payload.result) {
        const editor = useEditorStore.getState();
        editor.loadSourceTranscript(sourceId, payload.result.words, payload.result.speakers);
        editor.setSpeakerTurns(payload.result.speakerTurns);
        editor.addActivity("media_worker", `Finished transcription for ${editor.mediaSources.find((source) => source.id === sourceId)?.name ?? "source"}.`, "success");
        activePolls.delete(jobId);
        return;
      }
      if (payload.status === "error") throw new Error(payload.error || "Media worker could not process this source.");
      setWorkerProgress(sourceId, payload.progress ?? 0.02, payload.stage || payload.status);
      window.setTimeout(() => void check(), POLL_INTERVAL_MS);
    } catch (reason) {
      activePolls.delete(jobId);
      failWorkerSource(sourceId, reason);
    }
  };

  void check();
}

/** Queue a directly stored media source and keep its live editor state in sync. */
export async function queueMediaWorkerSource(sourceId: string): Promise<QueueResult> {
  const baseUrl = workerUrl();
  const editor = useEditorStore.getState();
  const source = editor.mediaSources.find((item) => item.id === sourceId);
  if (!baseUrl) return failWorkerSource(sourceId, new Error("This OpenCast deployment has no media worker URL configured."));
  if (!source?.storageUrl) return failWorkerSource(sourceId, new Error("Wait for direct media storage to finish before transcription starts."));
  if (source.ingestJobId && source.status === "transcribing") {
    pollWorkerJob(baseUrl, sourceId, source.ingestJobId);
    return { ok: true, jobId: source.ingestJobId };
  }

  try {
    setWorkerProgress(sourceId, 0.01, "authorizing");
    const ticket = await issueWorkerTicket(source);

    // A durable failed job has its media and completed chunks on Fly already.
    // Legacy jobs return 404 and safely start a fresh job instead.
    if (source.status === "error" && source.ingestJobId) {
      const resumeResponse = await fetch(`${baseUrl}/jobs/${encodeURIComponent(source.ingestJobId)}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      const resumePayload = await resumeResponse.json() as { id?: string; error?: string };
      if (resumeResponse.ok && resumePayload.id) {
        editor.updateMediaSource(sourceId, { status: "transcribing", processingProgress: 0.02, processingStage: "resuming", error: null });
        editor.addActivity("media_worker", `Resuming transcription for ${source.name}.`, "success");
        pollWorkerJob(baseUrl, sourceId, resumePayload.id);
        return { ok: true, jobId: resumePayload.id };
      }
      if (resumeResponse.status !== 404) throw new Error(resumePayload.error || "Could not resume the media worker job.");
    }

    const response = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
    const payload = await response.json() as { id?: string; error?: string };
    if (!response.ok || !payload.id) throw new Error(payload.error || "Media worker did not create a job.");

    editor.updateMediaSource(sourceId, { ingestJobId: payload.id, status: "transcribing", processingProgress: 0.02, processingStage: "queued", error: null });
    editor.addActivity("media_worker", `Queued transcription for ${source.name}.`, "success");
    pollWorkerJob(baseUrl, sourceId, payload.id);
    return { ok: true, jobId: payload.id };
  } catch (reason) {
    return failWorkerSource(sourceId, reason);
  }
}
