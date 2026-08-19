import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { allowFileRoot } from "@/lib/file-access";
import {
  allocateManagedSessionWorkspace,
  isManagedSessionMode,
} from "@/lib/managed-session-workspace";

// POST /api/default-cwd
// Creates ~/pi-cwd-<YYYYMMDD> if it doesn't exist and returns the path.
export async function POST() {
  try {
    if (isManagedSessionMode()) {
      const paths = allocateManagedSessionWorkspace();
      allowFileRoot(paths.workspace);
      return NextResponse.json({
        cwd: paths.workspace,
        sessionId: paths.sessionId,
        managedSessions: true,
      });
    }

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const dir = join(homedir(), `pi-cwd-${date}`);
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
