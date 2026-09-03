import { issueWorkerUploadTicket } from "@/lib/workerTicket";
import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/auth";

export const runtime = "nodejs";

const SOURCE_ID = /^[a-zA-Z0-9-]{16,}$/;
const DEFAULT_MAX_SOURCE_GB = 5;

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorizedRequest(request)) return NextResponse.json({ error: "Sign in to upload media." }, { status: 401 });
  try {
    const body = await request.json() as { sourceId?: unknown; filename?: unknown; size?: unknown; contentType?: unknown };
    if (typeof body.sourceId !== "string" || !SOURCE_ID.test(body.sourceId)) throw new Error("A valid media source is required.");
    if (typeof body.filename !== "string" || !body.filename.trim() || body.filename.length > 255) throw new Error("A valid media filename is required.");
    if (typeof body.size !== "number" || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > maxSourceBytes()) {
      throw new Error(`Media files must be smaller than ${maxSourceGigabytes()} GB.`);
    }
    if (typeof body.contentType !== "string" || !/^(audio|video)\//.test(body.contentType)) throw new Error("Choose an audio or video file.");
    const baseUrl = process.env.NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL?.replace(/\/$/, "");
    if (!baseUrl) throw new Error("Fly media storage is not configured.");
    return NextResponse.json({
      ticket: issueWorkerUploadTicket({
        sourceId: body.sourceId,
        filename: body.filename.trim(),
        size: body.size,
        contentType: body.contentType,
      }),
      uploadUrl: `${baseUrl}/uploads`,
      storagePath: body.sourceId,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not authorize the Fly media upload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function maxSourceBytes(): number {
  return maxSourceGigabytes() * 1024 * 1024 * 1024;
}

function maxSourceGigabytes(): number {
  const configured = Number(process.env.OPENCAST_MAX_SOURCE_GB);
  return Math.min(Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_SOURCE_GB, 5 * 1024);
}
