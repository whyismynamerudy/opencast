"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildWaveformEnvelope } from "@/lib/audio";
import { extractMono16kPcm } from "@/lib/ffmpeg";
import { useEditorStore } from "@/lib/store";
import type { Speaker, SpeakerTurn, TranscriptionStage, Word } from "@/lib/types";

type WorkerMessage =
  | { type: "progress"; jobId: string; stage: TranscriptionStage; progress: number; message: string }
  | { type: "complete"; jobId: string; words: Word[]; speakers: Speaker[]; speakerTurns: SpeakerTurn[] }
  | { type: "error"; jobId: string; message: string };

export function useTranscriber() {
  const workerRef = useRef<Worker | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const cancel = useCallback(() => {
    const jobId = activeJobRef.current;
    if (jobId) workerRef.current?.postMessage({ type: "cancel", jobId });
    activeJobRef.current = null;
    setRunning(false);
    useEditorStore.getState().setTranscriptionProgress({ stage: "idle", progress: 0, message: "Transcription cancelled.", error: null });
  }, []);

  const transcribe = useCallback(async (file: File) => {
    cancel();
    const jobId = crypto.randomUUID();
    activeJobRef.current = jobId;
    setRunning(true);
    const state = useEditorStore.getState();
    state.setTranscriptionProgress({ stage: "extracting", progress: 0.02, message: "Extracting local 16 kHz audio…", error: null });

    try {
      const pcm = await extractMono16kPcm(file, (ratio) => {
        if (activeJobRef.current === jobId) {
          useEditorStore.getState().setTranscriptionProgress({ stage: "extracting", progress: 0.02 + ratio * 0.06, message: "Extracting local 16 kHz audio…" });
        }
      });
      if (activeJobRef.current !== jobId) return;
      state.setWaveform(buildWaveformEnvelope(pcm));
      state.setTranscriptionProgress({ stage: "voice_activity", progress: 0.08, message: "Starting on-device speech analysis…" });

      const worker = workerRef.current ?? new Worker(new URL("../workers/transcription.worker.ts", import.meta.url));
      workerRef.current = worker;
      await new Promise<void>((resolve, reject) => {
        const onMessage = (event: MessageEvent<WorkerMessage>) => {
          const message = event.data;
          if (message.jobId !== jobId) return;
          if (message.type === "progress") {
            useEditorStore.getState().setTranscriptionProgress({ stage: message.stage, progress: message.progress, message: message.message, error: null });
            return;
          }
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          if (message.type === "error") {
            reject(new Error(message.message));
            return;
          }
          const editor = useEditorStore.getState();
          editor.loadTranscript(message.words, message.speakers);
          editor.setSpeakerTurns(message.speakerTurns);
          editor.setTranscriptionProgress({ stage: "complete", progress: 1, message: `Transcript ready: ${message.words.length} words, ${message.speakers.length} speaker${message.speakers.length === 1 ? "" : "s"}.`, error: null });
          editor.addActivity("on_device_transcription", `Created ${message.words.length} timed words with ${message.speakers.length} detected speaker${message.speakers.length === 1 ? "" : "s"}.`, "success");
          resolve();
        };
        const onError = () => {
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          reject(new Error("The local transcription worker stopped unexpectedly."));
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage({ type: "transcribe", jobId, samples: pcm.buffer, options: { diarize: true, align: true } }, [pcm.buffer]);
      });
    } catch (reason) {
      if (activeJobRef.current === jobId) {
        const message = reason instanceof Error ? reason.message : "Local transcription failed.";
        useEditorStore.getState().setTranscriptionProgress({ stage: "error", progress: 0, message: "Transcription could not complete.", error: message });
        useEditorStore.getState().addActivity("on_device_transcription", message, "error");
      }
    } finally {
      if (activeJobRef.current === jobId) activeJobRef.current = null;
      setRunning(false);
    }
  }, [cancel]);

  return { transcribe, cancel, running };
}
