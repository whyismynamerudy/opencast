import { isAuthorizedRequest } from "@/lib/auth";
import { issueWorkerMediaTicket } from "@/lib/workerTicket";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SOURCE_ID = /^[a-zA-Z0-9-]{16,}$/;

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorizedRequest(request)) return NextResponse.json({ error: "Sign in to play stored media." }, { status: 401 });
  try {
    const { sourceId } = await request.json() as { sourceId?: unknown };
    if (typeof sourceId !== "string" || !SOURCE_ID.test(sourceId)) throw new Error("A valid stored media source is required.");
    const baseUrl = process.env.NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL?.replace(/\/$/, "");
    if (!baseUrl) throw new Error("Fly media storage is not configured.");
    return NextResponse.json({
      url: `${baseUrl}/media/${sourceId}?ticket=${encodeURIComponent(issueWorkerMediaTicket(sourceId))}`,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not authorize media playback." }, { status: 400 });
  }
}
