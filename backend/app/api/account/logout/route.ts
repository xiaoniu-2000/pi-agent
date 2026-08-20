import { NextResponse } from "next/server";
import { buildExpiredWebSessionCookie } from "@/lib/web-auth";

export function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  response.headers.append("Set-Cookie", buildExpiredWebSessionCookie(request));
  return response;
}
