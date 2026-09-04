import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "opencast_admin_session";

/**
 * This is deliberately demo-only single-admin authentication. The credentials
 * live only in OPENCAST_AUTH_USERNAME / OPENCAST_AUTH_PASSWORD environment
 * variables — never in the repository — and login fails closed until both
 * are configured. Set OPENCAST_AUTH_SECRET as well so session cookies are
 * unique to your deployment.
 */
function adminUsername(): string {
  return process.env.OPENCAST_AUTH_USERNAME || "";
}

function adminPassword(): string {
  return process.env.OPENCAST_AUTH_PASSWORD || "";
}

function sessionSecret(): string {
  return process.env.OPENCAST_AUTH_SECRET || "opencast-demo-admin-session-secret";
}

function expectedSession(): string {
  return createHmac("sha256", sessionSecret()).update(`${adminUsername()}:authenticated`).digest("base64url");
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
  const expectedUsername = adminUsername();
  const expectedPassword = adminPassword();
  if (!expectedUsername || !expectedPassword) return false;
  return username === expectedUsername && password === expectedPassword;
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
