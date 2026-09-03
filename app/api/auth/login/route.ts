import { AUTH_COOKIE, createAdminSession, validAdminCredentials } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { username?: unknown; password?: unknown };
    if (!validAdminCredentials(body.username, body.password)) {
      return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
    }
    const response = NextResponse.json({ authenticated: true, username: "admin" });
    response.cookies.set(AUTH_COOKIE, createAdminSession(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Send a username and password." }, { status: 400 });
  }
}
