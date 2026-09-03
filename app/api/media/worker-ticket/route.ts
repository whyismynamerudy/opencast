import { issueWorkerJobTicket } from "@/lib/workerTicket";
import { NextResponse } from "next/server";
import { isAuthorizedRequest } from "@/lib/auth";

export const runtime = "nodejs";

const SOURCE_ID = /^[a-zA-Z0-9-]{16,}$/;

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorizedRequest(request)) return NextResponse.json({ error: "Sign in to process media." }, { status: 401 });
  try {
    const body = await request.json() as { sourceId?: unknown; filename?: unknown };
    if (typeof body.sourceId !== "string" || !SOURCE_ID.test(body.sourceId)) {
      return NextResponse.json({ error: "A completed Fly media upload is required." }, { status: 400 });
    }
    if (typeof body.filename !== "string" || !body.filename || body.filename.length > 255) {
      return NextResponse.json({ error: "A valid source filename is required." }, { status: 400 });
    }
    return NextResponse.json({ ticket: issueWorkerJobTicket({ sourceId: body.sourceId, filename: body.filename }) }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not authorize the media worker job.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
