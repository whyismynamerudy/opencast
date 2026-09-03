"use client";

import { useCallback } from "react";
import { queueMediaWorkerSource } from "@/lib/mediaWorkerClient";
import { useEditorStore } from "@/lib/store";

/** React adapter for the shared worker client. Jobs keep polling after an uploader unmounts. */
export function useMediaWorker() {
  const runningSourceIds = useEditorStore((state) => state.mediaSources
    .filter((source) => source.status === "transcribing")
    .map((source) => source.id));
  const processLargeSource = useCallback((sourceId: string) => queueMediaWorkerSource(sourceId), []);
  return { processLargeSource, runningSourceIds };
}
