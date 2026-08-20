import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { getRequestWebUser } from "@/lib/web-auth";

export async function GET(request: Request) {
  try {
    const user = getRequestWebUser(request);
    const sessions = await listAllSessions(user.id);
    return NextResponse.json({ sessions, runningSessionIds: getRunningRpcSessionIds(user.id) });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
