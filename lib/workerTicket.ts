import { createHmac } from "node:crypto";

const JOB_TICKET_TTL_MS = 10 * 60 * 1000;
const UPLOAD_TICKET_TTL_MS = 24 * 60 * 60 * 1000;
const MEDIA_TICKET_TTL_MS = 2 * 60 * 60 * 1000;
const PROJECT_TICKET_TTL_MS = 5 * 60 * 1000;

export type WorkerJobClaim = {
  kind: "job";
  expiresAt: number;
  filename: string;
  sourceId: string;
};

export type WorkerUploadClaim = {
  kind: "upload";
  contentType: string;
  expiresAt: number;
  filename: string;
  size: number;
  sourceId: string;
};

export type WorkerMediaClaim = {
  kind: "media";
  expiresAt: number;
  sourceId: string;
};

export type WorkerProjectClaim = {
  kind: "project";
  expiresAt: number;
};

function signingSecret(): string {
  const secret = process.env.OPENCAST_WORKER_SIGNING_SECRET;
  if (!secret) throw new Error("Media worker authorization is not configured.");
  return secret;
}

function signClaim(claim: WorkerJobClaim | WorkerUploadClaim | WorkerMediaClaim | WorkerProjectClaim): string {
  const encoded = Buffer.from(JSON.stringify(claim)).toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function issueWorkerJobTicket(input: Omit<WorkerJobClaim, "expiresAt" | "kind">): string {
  return signClaim({ ...input, kind: "job", expiresAt: Date.now() + JOB_TICKET_TTL_MS });
}

export function issueWorkerUploadTicket(input: Omit<WorkerUploadClaim, "expiresAt" | "kind">): string {
  return signClaim({ ...input, kind: "upload", expiresAt: Date.now() + UPLOAD_TICKET_TTL_MS });
}

export function issueWorkerMediaTicket(sourceId: string): string {
  return signClaim({ kind: "media", sourceId, expiresAt: Date.now() + MEDIA_TICKET_TTL_MS });
}

/** Used only by authenticated Next.js project-proxy routes. */
export function issueWorkerProjectTicket(): string {
  return signClaim({ kind: "project", expiresAt: Date.now() + PROJECT_TICKET_TTL_MS });
}
