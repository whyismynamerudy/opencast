"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/store";
import type { Speaker, SpeakerTurn, Word } from "@/lib/types";

type HostedTranscription = {
  words: Word[];
  speakers: Speaker[];
  speakerTurns: SpeakerTurn[];
};

export function useTranscriber() {
  const controllerRef = useRef<AbortController | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    activeJobRef.current = null;
    setRunning(false);
    useEditorStore.getState().setTranscriptionProgress({
      stage: "idle",
      progress: 0,
      message: "Transcription cancelled.",
      error: null,
    });
  }, []);

  const transcribe = useCallback(async (file: File, sourceId?: string) => {
    cancel();
    const jobId = crypto.randomUUID();
    const controller = new AbortController();
    activeJobRef.current = jobId;
    controllerRef.current = controller;
    setRunning(true);
    useEditorStore.getState().setTranscriptionProgress({
      stage: "transcribing",
      progress: 0.12,
      message: "Uploading media for cloud transcription…",
      error: null,
    });
    if (sourceId) useEditorStore.getState().updateMediaSource(sourceId, { status: "transcribing", error: null });

    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const response = await fetch("/api/transcribe", { method: "POST", body: form, signal: controller.signal });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload) ?? "Cloud transcription could not complete.");
      if (!isHostedTranscription(payload)) throw new Error("OpenCast received an invalid transcription response.");
      if (activeJobRef.current !== jobId) return;

      const editor = useEditorStore.getState();
      if (sourceId) editor.loadSourceTranscript(sourceId, payload.words, payload.speakers);
      else editor.loadTranscript(payload.words, payload.speakers);
      editor.setSpeakerTurns(payload.speakerTurns);
      editor.setTranscriptionProgress({
        stage: "complete",
        progress: 1,
        message: `Transcript ready: ${payload.words.length} words, ${payload.speakers.length} speaker${payload.speakers.length === 1 ? "" : "s"}.`,
        error: null,
      });
      editor.addActivity("cloud_transcription", `OpenAI produced ${payload.words.length} timed words and ${payload.speakers.length} detected speaker${payload.speakers.length === 1 ? "" : "s"}.`, "success");
    } catch (reason) {
      if (activeJobRef.current === jobId && !controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : "Cloud transcription failed.";
        useEditorStore.getState().setTranscriptionProgress({
          stage: "error",
          progress: 0,
          message: "Cloud transcription needs attention.",
          error: message,
        });
        if (sourceId) useEditorStore.getState().updateMediaSource(sourceId, { status: "error", error: message });
        useEditorStore.getState().addActivity("cloud_transcription", message, "error");
      }
    } finally {
      const isActiveJob = activeJobRef.current === jobId;
      if (isActiveJob) activeJobRef.current = null;
      if (controllerRef.current === controller) controllerRef.current = null;
      if (isActiveJob) setRunning(false);
    }
  }, [cancel]);

  return { transcribe, cancel, running };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(payload: unknown): string | null {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : null;
}

function isHostedTranscription(payload: unknown): payload is HostedTranscription {
  return Boolean(
    payload
      && typeof payload === "object"
      && "words" in payload
      && "speakers" in payload
      && "speakerTurns" in payload
      && Array.isArray(payload.words)
      && Array.isArray(payload.speakers)
      && Array.isArray(payload.speakerTurns),
  );
}
