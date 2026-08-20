import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { allowFileRoot } from "@/lib/file-access";
import {
  allocateManagedSessionWorkspace,
  isManagedSessionMode,
} from "@/lib/managed-session-workspace";
import { getRequestWebUser } from "@/lib/web-auth";

// POST /api/default-cwd
// Creates ~/pi-cwd-<YYYYMMDD> if it doesn't exist and returns the path.
export async function POST(request: Request) {
  try {
    const user = getRequestWebUser(request);
    if (isManagedSessionMode()) {
      const paths = allocateManagedSessionWorkspace(user.id);
      allowFileRoot(paths.workspace, user.id);
      return NextResponse.json({
        cwd: paths.workspace,
        sessionId: paths.sessionId,
        managedSessions: true,
      });
    }

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const dir = join(homedir(), `pi-cwd-${date}`);
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir, user.id);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
