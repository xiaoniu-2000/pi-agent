import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import {
  getBrowseStartDirectory,
  getParentDirectory,
  listDirectories,
  resolveDirectory,
} from "@/lib/directory-browser";
import { isManagedSessionMode } from "@/lib/managed-session-workspace";

// GET /api/cwd/browse?path=...：列出文件系统中的可读子目录。
export async function GET(request: NextRequest) {
  try {
    if (isManagedSessionMode()) {
      return NextResponse.json(
        { error: "Directory browsing is disabled in managed-session mode" },
        { status: 403 },
      );
    }
    const requested = request.nextUrl.searchParams.get("path")?.trim();
    const candidate = getBrowseStartDirectory(requested);

    let resolved: string;
    try {
      resolved = await resolveDirectory(candidate);
    } catch {
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }


    const directoryStat = await stat(resolved);
    if (!directoryStat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    const directories = await listDirectories(resolved);

    return NextResponse.json({
      path: resolved,
      parentPath: getParentDirectory(resolved),
      directories,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
