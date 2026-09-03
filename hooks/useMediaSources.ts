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

  const uploadSource = useCallback(async (sourceId: string, file: File) => {
    const editor = useEditorStore.getState();
    editor.updateMediaSource(sourceId, { status: "uploading", uploadProgress: 0, error: null });
    try {
      const stored = await uploadMediaSource(sourceId, file, (percentage) => {
        useEditorStore.getState().updateMediaSource(sourceId, { uploadProgress: percentage });
      }, (storagePath) => {
        useEditorStore.getState().updateMediaSource(sourceId, { storagePath });
      });
      const current = useEditorStore.getState().mediaSources.find((source) => source.id === sourceId);
      useEditorStore.getState().updateMediaSource(sourceId, {
        status: current?.status === "ready" ? "ready" : "uploaded",
        uploadProgress: 1,
        processingProgress: 0,
        processingStage: null,
        storagePath: stored.storagePath,
      });
      useEditorStore.getState().addActivity("media_upload", `Stored ${file.name} on the OpenCast media worker.`, "success");
      await queueMediaWorkerSource(sourceId);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Fly media upload failed.";
      useEditorStore.getState().updateMediaSource(sourceId, { status: "local", error: message });
      useEditorStore.getState().addActivity("media_upload", `${file.name} remains available in this browser: ${message}`, "info");
    }
  }, []);

  const importFiles = useCallback(async (files: File[], roles?: SourceRole[]) => {
    if (!files.length) return [];
    setImporting(true);
    const editor = useEditorStore.getState();
    try {
      const imported = await Promise.all(files.map(async (file, index) => {
        const localUrl = URL.createObjectURL(file);
        try {
          const resumableSource = editor.mediaSources.find((source) => source.status === "local"
            && Boolean(source.storagePath)
            && source.name === file.name
            && source.fileSize === file.size);
          if (resumableSource) {
            editor.updateMediaSource(resumableSource.id, { file, localUrl, error: null });
            editor.addActivity("media_upload", `Resuming ${file.name} from its stored upload offset.`, "success");
            await uploadSource(resumableSource.id, file);
            return { sourceId: resumableSource.id, file };
          }
          const sourceId = editor.addMediaSource({
            name: file.name,
            role: roles?.[index] ?? ROLES[Math.min(editor.mediaSources.length + index, ROLES.length - 1)],
            kind: file.type.startsWith("audio/") ? "audio" : "video",
            // Upload begins immediately. Browser metadata can be slow on large
            // MP4s, but it is not a prerequisite for preview or cloud ingest.
            duration: 0,
            fileSize: file.size,
            file,
            localUrl,
          });
          editor.addActivity("media_source_added", `Added ${file.name} as a ${roles?.[index] ?? "source"} angle.`, "success");
          void probeMediaDuration(file, localUrl)
            .then((duration) => {
              useEditorStore.getState().updateMediaSource(sourceId, { duration });
            })
            .catch(() => {
              // The worker transcript supplies a duration later. Never make a
              // large upload wait on a browser codec or metadata response.
              useEditorStore.getState().addActivity("media_metadata", `Reading duration for ${file.name} is taking longer than usual. Upload continues.`, "info");
            });

          await uploadSource(sourceId, file);
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
  }, [uploadSource]);

  const resumeSource = useCallback(async (sourceId: string) => {
    const source = useEditorStore.getState().mediaSources.find((item) => item.id === sourceId);
    if (!source?.file) return false;
    setImporting(true);
    try {
      await uploadSource(source.id, source.file);
      return true;
    } finally {
      setImporting(false);
    }
  }, [uploadSource]);

  return { importFiles, importing, resumeSource };
}
