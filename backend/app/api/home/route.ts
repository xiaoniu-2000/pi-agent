import { NextResponse } from "next/server";
import { homedir } from "os";
import {
  getManagedUserId,
  getManagedUserRoot,
  isManagedSessionMode,
} from "@/lib/managed-session-workspace";
import { getRequestWebUser } from "@/lib/web-auth";

export async function GET(request: Request) {
  const user = getRequestWebUser(request);
  if (isManagedSessionMode()) {
    return NextResponse.json({
      home: getManagedUserRoot(user.id),
      userId: getManagedUserId(user.id),
      managedSessions: true,
    });
  }
  return NextResponse.json({ home: homedir(), managedSessions: false });
}
