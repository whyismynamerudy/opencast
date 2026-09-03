import { isAuthorizedRequest } from "@/lib/auth";
import { projectWorkerRequest } from "@/lib/projectWorker";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorizedRequest(request)) return json({ error: "Sign in to view projects." }, 401);
  try {
    const result = await projectWorkerRequest("/projects");
    return json(result.body, result.status);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load projects." }, 503);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorizedRequest(request)) return json({ error: "Sign in to create a project." }, 401);
  try {
    const body = await request.json();
    const result = await projectWorkerRequest("/projects", { method: "POST", body: JSON.stringify(body) });
    return json(result.body, result.status);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not create the project." }, 400);
  }
}
