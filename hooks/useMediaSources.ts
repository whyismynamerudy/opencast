"use client";

import { useCallback, useState } from "react";
import { uploadMediaSource } from "@/lib/mediaUpload";
import { queueMediaWorkerSource } from "@/lib/mediaWorkerClient";
import type { SourceRole } from "@/lib/multicam";
import { useEditorStore } from "@/lib/store";

const ROLES: SourceRole[] = ["host", "guest", "screen", "b-roll", "other"];

export async function probeMediaDuration(file: File, url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = document.createElement(file.type.startsWith("audio/") ? "audio" : "video");
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      const duration = Number.isFinite(element.duration) ? element.duration : 0;
      element.removeAttribute("src");
      element.load();
      resolve(duration);
    };
    element.onerror = () => reject(new Error(`OpenCast could not read ${file.name}.`));
    element.src = url;
  });
}

export function useMediaSources() {
  const [importing, setImporting] = useState(false);

  const importFiles = useCallback(async (files: File[], roles?: SourceRole[]) => {
    if (!files.length) return [];
    setImporting(true);
    const editor = useEditorStore.getState();
    try {
      const imported = await Promise.all(files.map(async (file, index) => {
        const localUrl = URL.createObjectURL(file);
        try {
          const duration = await probeMediaDuration(file, localUrl);
          const sourceId = editor.addMediaSource({
            name: file.name,
            role: roles?.[index] ?? ROLES[Math.min(editor.mediaSources.length + index, ROLES.length - 1)],
            kind: file.type.startsWith("audio/") ? "audio" : "video",
            duration,
            file,
            localUrl,
          });
          editor.addActivity("media_source_added", `Added ${file.name} as a ${roles?.[index] ?? "source"} angle.`, "success");
          editor.updateMediaSource(sourceId, { status: "uploading", uploadProgress: 0, error: null });
          try {
            const stored = await uploadMediaSource(sourceId, file, (percentage) => {
              useEditorStore.getState().updateMediaSource(sourceId, { uploadProgress: percentage });
            });
            const current = useEditorStore.getState().mediaSources.find((source) => source.id === sourceId);
            useEditorStore.getState().updateMediaSource(sourceId, {
              status: current?.status === "ready" ? "ready" : "uploaded",
              uploadProgress: 1,
              processingProgress: 0,
              processingStage: null,
              storageUrl: stored.url,
              storagePath: stored.pathname,
            });
            useEditorStore.getState().addActivity("media_upload", `Stored ${file.name} directly in project media storage.`, "success");
            await queueMediaWorkerSource(sourceId);
          } catch (reason) {
            const message = reason instanceof Error ? reason.message : "Cloud storage upload failed.";
            useEditorStore.getState().updateMediaSource(sourceId, { status: "local", error: message });
            useEditorStore.getState().addActivity("media_upload", `${file.name} remains available in this browser: ${message}`, "info");
          }
          return { sourceId, file };
        } catch (reason) {
          URL.revokeObjectURL(localUrl);
          throw reason;
        }
      }));
      return imported;
    } finally {
      setImporting(false);
    }
  }, []);

  return { importFiles, importing };
}
