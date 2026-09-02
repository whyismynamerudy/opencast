import { createHmac } from "node:crypto";

const TICKET_TTL_MS = 10 * 60 * 1000;

export type WorkerJobClaim = {
  expiresAt: number;
  filename: string;
  sourceId: string;
  sourceUrl: string;
};

function signingSecret(): string {
  const secret = process.env.OPENCAST_WORKER_SIGNING_SECRET;
  if (!secret) throw new Error("Media worker authorization is not configured.");
  return secret;
}

export function isProjectMediaUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export function issueWorkerJobTicket(input: Omit<WorkerJobClaim, "expiresAt">): string {
  const claim: WorkerJobClaim = { ...input, expiresAt: Date.now() + TICKET_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(claim)).toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}
