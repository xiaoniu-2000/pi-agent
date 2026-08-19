import { NextResponse } from "next/server";
import { homedir } from "os";
import {
  getManagedUserId,
  getManagedUserRoot,
  isManagedSessionMode,
} from "@/lib/managed-session-workspace";

export async function GET() {
  if (isManagedSessionMode()) {
    return NextResponse.json({
      home: getManagedUserRoot(),
      userId: getManagedUserId(),
      managedSessions: true,
    });
  }
  return NextResponse.json({ home: homedir(), managedSessions: false });
}
