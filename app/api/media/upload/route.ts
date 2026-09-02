import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_MAX_SOURCE_GB = 5;
const MEDIA_TYPES = ["video/*", "audio/*"];

export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Direct media storage is not configured. Set BLOB_READ_WRITE_TOKEN on this deployment." },
      { status: 503 },
    );
  }

  try {
    const body = await request.json() as HandleUploadBody;
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = parsePayload(clientPayload);
        if (!payload || !pathname.startsWith(`opencast/${payload.sourceId}/`)) {
          throw new Error("Invalid media destination.");
        }
        return {
          allowedContentTypes: MEDIA_TYPES,
          maximumSizeInBytes: maxSourceBytes(),
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ sourceId: payload.sourceId }),
        };
      },
      // Project persistence belongs to the authenticated product layer. The
      // browser already receives the durable Blob URL from upload(), so this
      // callback intentionally has no database side effect in the demo.
      onUploadCompleted: async () => undefined,
    });
    return NextResponse.json(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare the media upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function parsePayload(value: string | null): { sourceId: string } | null {
  if (!value) return null;
  try {
    const payload = JSON.parse(value) as { sourceId?: unknown };
    return typeof payload.sourceId === "string" && /^[a-zA-Z0-9-]{16,}$/.test(payload.sourceId)
      ? { sourceId: payload.sourceId }
      : null;
  } catch {
    return null;
  }
}

function maxSourceBytes(): number {
  const configured = Number(process.env.OPENCAST_MAX_SOURCE_GB);
  const gigabytes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_SOURCE_GB;
  return Math.min(gigabytes, 5 * 1024) * 1024 * 1024 * 1024;
}
