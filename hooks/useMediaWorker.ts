"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import type { Speaker, SpeakerTurn, Word } from "@/lib/types";

type WorkerStatus = {
  status: "queued" | "processing" | "complete" | "error";
  progress?: number;
  error?: string;
  result?: { words: Word[]; speakers: Speaker[]; speakerTurns: SpeakerTurn[] };
};

function workerUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL?.replace(/\/$/, "");
  return value || null;
}

/** Starts and polls the optional Docker media worker for large sources. */
export function useMediaWorker() {
  const timers = useRef(new Set<number>());
  const [runningSourceIds, setRunningSourceIds] = useState<string[]>([]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const poll = useCallback((baseUrl: string, sourceId: string, jobId: string) => {
    async function checkStatus() {
      try {
        const response = await fetch(`${baseUrl}/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const payload = await response.json() as WorkerStatus;
        if (!response.ok) throw new Error(payload.error || "Media worker status is unavailable.");
        if (payload.status === "complete" && payload.result) {
          const editor = useEditorStore.getState();
          editor.loadSourceTranscript(sourceId, payload.result.words, payload.result.speakers);
          editor.setSpeakerTurns(payload.result.speakerTurns);
          editor.addActivity("media_worker", `Finished large-source transcription for ${editor.mediaSources.find((source) => source.id === sourceId)?.name ?? "source"}.`, "success");
          setRunningSourceIds((ids) => ids.filter((id) => id !== sourceId));
          return;
        }
        if (payload.status === "error") throw new Error(payload.error || "Media worker could not process this source.");
        const timer = window.setTimeout(() => {
          timers.current.delete(timer);
          void checkStatus();
        }, 2_000);
        timers.current.add(timer);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Media worker could not process this source.";
        useEditorStore.getState().updateMediaSource(sourceId, { status: "error", error: message });
        useEditorStore.getState().addActivity("media_worker", message, "error");
        setRunningSourceIds((ids) => ids.filter((id) => id !== sourceId));
      }
    }
    void checkStatus();
  }, []);

  const processLargeSource = useCallback(async (sourceId: string) => {
    const baseUrl = workerUrl();
    const source = useEditorStore.getState().mediaSources.find((item) => item.id === sourceId);
    if (!baseUrl) {
      const message = "Set NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL to transcribe large sources with the included media worker.";
      useEditorStore.getState().updateMediaSource(sourceId, { status: "needs-worker", error: message });
      useEditorStore.getState().addActivity("media_worker", message, "info");
      return false;
    }
    if (!source?.storageUrl) {
      const message = "Wait for direct media storage to finish before queueing this source.";
      useEditorStore.getState().updateMediaSource(sourceId, { status: "needs-worker", error: message });
      return false;
    }
    try {
      setRunningSourceIds((ids) => ids.includes(sourceId) ? ids : [...ids, sourceId]);
      useEditorStore.getState().updateMediaSource(sourceId, { status: "transcribing", error: null });
      const ticketResponse = await fetch("/api/media/worker-ticket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceUrl: source.storageUrl, sourceId, filename: source.name }),
      });
      const ticketPayload = await ticketResponse.json() as { ticket?: string; error?: string };
      if (!ticketResponse.ok || !ticketPayload.ticket) throw new Error(ticketPayload.error || "Could not authorize the media worker job.");
      const response = await fetch(`${baseUrl}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket: ticketPayload.ticket }),
      });
      const payload = await response.json() as { id?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.error || "Media worker did not create a job.");
      useEditorStore.getState().updateMediaSource(sourceId, { ingestJobId: payload.id });
      useEditorStore.getState().addActivity("media_worker", `Queued large-source transcription for ${source.name}.`, "success");
      poll(baseUrl, sourceId, payload.id);
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Media worker could not start.";
      useEditorStore.getState().updateMediaSource(sourceId, { status: "needs-worker", error: message });
      setRunningSourceIds((ids) => ids.filter((id) => id !== sourceId));
      return false;
    }
  }, [poll]);

  return { processLargeSource, runningSourceIds };
}
