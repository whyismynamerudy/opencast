import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "opencast_admin_session";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin";

/**
 * This is deliberately demo-only authentication requested for the hackathon.
 * Configure OPENCAST_AUTH_SECRET before exposing a real account system.
 */
function sessionSecret(): string {
  return process.env.OPENCAST_AUTH_SECRET || "opencast-demo-admin-session-secret";
}

function expectedSession(): string {
  return createHmac("sha256", sessionSecret()).update(`${ADMIN_USERNAME}:authenticated`).digest("base64url");
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  const prefix = `${name}=`;
  for (const part of header.split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return null;
}

export function validAdminCredentials(username: unknown, password: unknown): boolean {
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

export function createAdminSession(): string {
  return expectedSession();
}

export function isAdminSession(value: string | null | undefined): boolean {
  if (!value) return false;
  const expected = Buffer.from(expectedSession());
  const received = Buffer.from(value);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function isAuthorizedRequest(request: Request): boolean {
  return isAdminSession(cookieValue(request.headers.get("cookie"), AUTH_COOKIE));
}
