import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import {
  discardPristineManagedSessionWorkspace,
  managedSessionFromWorkspace,
} from "@/lib/managed-session-workspace";

// POST /api/default-cwd/discard
// Best-effort cleanup for an allocated browser draft that was never used.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const cwd = form.get("cwd");
    if (typeof cwd !== "string" || !cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const paths = managedSessionFromWorkspace(cwd);
    if (!paths) {
      return NextResponse.json({ error: "cwd is not a managed session workspace" }, { status: 400 });
    }

    // Never race a prompt, command, or initialized Agent session during page exit.
    if (getRpcSession(paths.sessionId)) {
      return NextResponse.json({ discarded: false, reason: "active_session" });
    }

    const discarded = discardPristineManagedSessionWorkspace(cwd);
    return NextResponse.json({
      discarded,
      ...(discarded ? {} : { reason: "session_has_content" }),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
