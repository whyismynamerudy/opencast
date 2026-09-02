"use client";

import { upload } from "@vercel/blob/client";

export type UploadedMedia = {
  url: string;
  pathname: string;
};

export async function uploadMediaSource(
  sourceId: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<UploadedMedia> {
  const safeName = file.name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "recording";
  const pathname = `opencast/${sourceId}/${safeName}`;
  const blob = await upload(pathname, file, {
    access: "public",
    contentType: file.type || undefined,
    handleUploadUrl: "/api/media/upload",
    clientPayload: JSON.stringify({ sourceId }),
    // The Blob SDK chunks, retries, and resumes parts. This is important for a
    // long HD episode, and keeps its bytes off the Next.js request path.
    multipart: file.size > 100 * 1024 * 1024,
    onUploadProgress: ({ percentage }) => onProgress(percentage),
  });
  return { url: blob.url, pathname: blob.pathname };
}
