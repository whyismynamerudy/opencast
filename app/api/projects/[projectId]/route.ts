import { isAuthorizedRequest } from "@/lib/auth";
import { projectWorkerRequest } from "@/lib/projectWorker";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const PROJECT_ID = /^[a-zA-Z0-9-]{16,}$/;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function pathFor(projectId: string) {
  if (!PROJECT_ID.test(projectId)) throw new Error("A valid project id is required.");
  return `/projects/${encodeURIComponent(projectId)}`;
}

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Context): Promise<NextResponse> {
  if (!isAuthorizedRequest(request)) return json({ error: "Sign in to open projects." }, 401);
  try {
    const result = await projectWorkerRequest(pathFor((await params).projectId));
    return json(result.body, result.status);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not open the project." }, 400);
  }
}

export async function PUT(request: Request, { params }: Context): Promise<NextResponse> {
  if (!isAuthorizedRequest(request)) return json({ error: "Sign in to save projects." }, 401);
  try {
    const body = await request.json();
    const result = await projectWorkerRequest(pathFor((await params).projectId), { method: "PUT", body: JSON.stringify(body) });
    return json(result.body, result.status);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not save the project." }, 400);
  }
}

export async function DELETE(request: Request, { params }: Context): Promise<NextResponse> {
  if (!isAuthorizedRequest(request)) return json({ error: "Sign in to delete projects." }, 401);
  try {
    const result = await projectWorkerRequest(pathFor((await params).projectId), { method: "DELETE" });
    return json(result.body, result.status);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not delete the project." }, 400);
  }
}
