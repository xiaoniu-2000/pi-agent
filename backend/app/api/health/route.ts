import { NextResponse } from "next/server";
import { isManagedSessionMode } from "@/lib/managed-session-workspace";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "pi-web-backend",
    managedSessions: isManagedSessionMode(),
    timestamp: new Date().toISOString()
  });
}
