import { issueWorkerProjectTicket } from "@/lib/workerTicket";

type WorkerResponse = {
  status: number;
  body: Record<string, unknown>;
};

function workerUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_OPENCAST_MEDIA_WORKER_URL?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("Fly project storage is not configured.");
  return baseUrl;
}

/**
 * Project traffic is proxied through authenticated Next.js routes. The short
 * Fly ticket never reaches the browser, unlike media-upload tickets which must
 * be browser-visible for direct resumable uploads.
 */
export async function projectWorkerRequest(path: string, init: RequestInit = {}): Promise<WorkerResponse> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${issueWorkerProjectTicket()}`);
  if (init.body) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${workerUrl()}${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    throw new Error("Fly project storage is unavailable.");
  }
  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    body = { error: "Fly project storage returned an unreadable response." };
  }
  return { status: response.status, body };
}
