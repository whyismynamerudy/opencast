"use client";

export type UploadedMedia = { storagePath: string };

const CHUNK_BYTES = 16 * 1024 * 1024;
const RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000];

type UploadAuthorization = {
  ticket: string;
  uploadUrl: string;
  storagePath: string;
};

export async function uploadMediaSource(
  sourceId: string,
  file: File,
  onProgress: (progress: number) => void,
  onStorageReserved?: (storagePath: string) => void,
): Promise<UploadedMedia> {
  const authorization = await authorizeUpload(sourceId, file);
  onStorageReserved?.(authorization.storagePath);
  const headers = { authorization: `Bearer ${authorization.ticket}` };
  let offset = await prepareUpload(authorization.uploadUrl, headers);
  onProgress(offset / file.size);

  while (offset < file.size) {
    const next = Math.min(file.size, offset + CHUNK_BYTES);
    const chunk = file.slice(offset, next);
    offset = await sendChunk(authorization.uploadUrl, headers, offset, chunk);
    onProgress(offset / file.size);
  }
  return { storagePath: authorization.storagePath };
}

async function authorizeUpload(sourceId: string, file: File): Promise<UploadAuthorization> {
  const response = await fetch("/api/media/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceId, filename: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
  });
  const payload = await response.json() as Partial<UploadAuthorization> & { error?: string };
  if (!response.ok || !payload.ticket || !payload.uploadUrl || !payload.storagePath) throw new Error(payload.error || "Could not authorize the Fly media upload.");
  return { ticket: payload.ticket, uploadUrl: payload.uploadUrl, storagePath: payload.storagePath };
}

async function prepareUpload(uploadUrl: string, headers: Record<string, string>): Promise<number> {
  const response = await requestWithRetry(() => fetch(uploadUrl, {
    method: "POST",
    headers,
  }));
  const payload = await response.json() as { offset?: unknown; error?: string };
  if (!response.ok || typeof payload.offset !== "number") throw new Error(payload.error || "Fly could not prepare this media upload.");
  return payload.offset;
}

async function sendChunk(uploadUrl: string, headers: Record<string, string>, offset: number, chunk: Blob): Promise<number> {
  const response = await requestWithRetry(() => fetch(uploadUrl, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/offset+octet-stream", "upload-offset": String(offset) },
    body: chunk,
  }));
  const nextOffset = Number(response.headers.get("upload-offset"));
  if (response.ok && Number.isSafeInteger(nextOffset) && nextOffset >= offset) return nextOffset;
  const payload = await response.json().catch(() => null) as { error?: string; offset?: number } | null;
  const resumedOffset = payload?.offset;
  if (response.status === 409 && typeof resumedOffset === "number" && Number.isSafeInteger(resumedOffset) && resumedOffset >= offset) return resumedOffset;
  throw new Error(payload?.error || "Fly could not store this media chunk.");
}

async function requestWithRetry(request: () => Promise<Response>): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await request();
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)) return response;
      lastError = new Error(`Fly media upload failed (${response.status}).`);
    } catch (error) {
      lastError = error;
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) break;
    await new Promise((resolve) => window.setTimeout(resolve, delay));
  }
  throw lastError instanceof Error ? lastError : new Error("Fly media upload did not receive a response.");
}
