"use client";

import { useCallback } from "react";
import { queueMediaWorkerSource } from "@/lib/mediaWorkerClient";

/** React adapter for the shared worker client. Jobs keep polling after an uploader unmounts. */
export function useMediaWorker() {
  const processLargeSource = useCallback((sourceId: string) => queueMediaWorkerSource(sourceId), []);
  return { processLargeSource };
}
