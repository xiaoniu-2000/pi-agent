import { NextResponse } from "next/server";
import { isManagedSessionMode } from "@/lib/managed-session-workspace";
import { getWebAuthStatus } from "@/lib/web-auth";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "pi-web-backend",
    managedSessions: isManagedSessionMode(),
    webAuth: getWebAuthStatus(),
    timestamp: new Date().toISOString()
  });
}
