import { isAuthorizedRequest } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const authenticated = isAuthorizedRequest(request);
  return NextResponse.json({ authenticated, username: authenticated ? "admin" : null }, { status: authenticated ? 200 : 401 });
}
