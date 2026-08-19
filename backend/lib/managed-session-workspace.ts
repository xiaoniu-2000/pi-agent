import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { randomUUID } from "crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface ManagedSessionPaths {
  userId: string;
  userRoot: string;
  sessionsRoot: string;
  sessionId: string;
  sessionRoot: string;
  workspace: string;
}

function configuredUserDataRoot(): string | null {
  const value = process.env.PI_WEB_USER_DATA_ROOT?.trim();
  if (!value) return null;
  if (!isAbsolute(value)) {
    throw new Error("PI_WEB_USER_DATA_ROOT must be an absolute path");
  }
  return resolve(value);
}

/** Enable managed sessions by setting PI_WEB_USER_DATA_ROOT. */
export function isManagedSessionMode(): boolean {
  return configuredUserDataRoot() !== null;
}

/** Stage 1 uses a fixed identity; Stage 2 will replace this with auth state. */
export function getManagedUserId(): string {
  const userId = process.env.PI_WEB_FIXED_USER_ID?.trim() || "user1";
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error(
      "PI_WEB_FIXED_USER_ID must contain only letters, numbers, '.', '_' or '-'",
    );
  }
  return userId;
}

export function getManagedUserRoot(): string {
  const dataRoot = configuredUserDataRoot();
  if (!dataRoot) throw new Error("Managed-session mode is not enabled");
  return join(dataRoot, getManagedUserId());
}

export function getManagedSessionsRoot(): string {
  return join(getManagedUserRoot(), "sessions");
}

/** ISO 8601 timestamp with an explicit China Standard Time (+08:00) offset. */
export function toBeijingISOString(date = new Date()): string {
  return new Date(date.getTime() + BEIJING_UTC_OFFSET_MS)
    .toISOString()
    .replace(/Z$/, "+08:00");
}

function pathsForSessionId(sessionId: string): ManagedSessionPaths {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Invalid managed session id: ${sessionId}`);
  }
  const userId = getManagedUserId();
  const userRoot = getManagedUserRoot();
  const sessionsRoot = join(userRoot, "sessions");
  const sessionRoot = join(sessionsRoot, sessionId);
  return {
    userId,
    userRoot,
    sessionsRoot,
    sessionId,
    sessionRoot,
    workspace: join(sessionRoot, "workspace"),
  };
}

export function allocateManagedSessionWorkspace(): ManagedSessionPaths {
  const sessionsRoot = getManagedSessionsRoot();
  mkdirSync(sessionsRoot, { recursive: true, mode: 0o750 });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const sessionId = randomUUID();
    const paths = pathsForSessionId(sessionId);
    if (existsSync(paths.sessionRoot)) continue;

    mkdirSync(paths.sessionRoot, { mode: 0o750 });
    mkdirSync(paths.workspace, { mode: 0o750 });
    writeFileSync(
      join(paths.sessionRoot, "meta.json"),
      `${JSON.stringify({
        version: 1,
        userId: paths.userId,
        sessionId,
        createdAt: toBeijingISOString(),
      }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o640 },
    );
    return paths;
  }

  throw new Error("Unable to allocate a unique managed session directory");
}

/** Resolve an exact <user>/sessions/<session-id>/workspace path. */
export function managedSessionFromWorkspace(cwd: string): ManagedSessionPaths | null {
  if (!isManagedSessionMode() || !cwd) return null;
  const sessionsRoot = getManagedSessionsRoot();
  const resolvedCwd = resolve(cwd);
  const rel = relative(sessionsRoot, resolvedCwd);
  const parts = rel.split(sep);
  if (
    rel.startsWith(`..${sep}`)
    || rel === ".."
    || parts.length !== 2
    || parts[1] !== "workspace"
    || !SESSION_ID_PATTERN.test(parts[0])
  ) {
    return null;
  }

  const paths = pathsForSessionId(parts[0]);
  if (resolve(paths.workspace) !== resolvedCwd) return null;
  try {
    if (!lstatSync(paths.sessionRoot).isDirectory()) return null;
    const workspaceStat = lstatSync(paths.workspace);
    if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  return paths;
}

/** Resolve a JSONL stored directly in <user>/sessions/<session-id>/. */
export function managedSessionFromFile(filePath: string): ManagedSessionPaths | null {
  if (!isManagedSessionMode() || !filePath) return null;
  const sessionsRoot = getManagedSessionsRoot();
  const resolvedFile = resolve(filePath);
  const rel = relative(sessionsRoot, resolvedFile);
  const parts = rel.split(sep);
  if (
    rel.startsWith(`..${sep}`)
    || rel === ".."
    || parts.length !== 2
    || !SESSION_ID_PATTERN.test(parts[0])
    || !parts[1].endsWith(".jsonl")
  ) {
    return null;
  }

  const paths = pathsForSessionId(parts[0]);
  return dirname(resolvedFile) === paths.sessionRoot ? paths : null;
}

export function listManagedSessionRoots(): string[] {
  if (!isManagedSessionMode()) return [];
  const sessionsRoot = getManagedSessionsRoot();
  if (!existsSync(sessionsRoot)) return [];

  return readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SESSION_ID_PATTERN.test(entry.name))
    .map((entry) => join(sessionsRoot, entry.name));
}

export function listManagedSessionFiles(): string[] {
  const files: string[] = [];
  for (const sessionRoot of listManagedSessionRoots()) {
    for (const entry of readdirSync(sessionRoot, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(join(sessionRoot, entry.name));
      }
    }
  }
  return files;
}

export function copyManagedWorkspace(sourceCwd: string, destinationCwd: string): void {
  if (!existsSync(sourceCwd)) return;
  if (!statSync(sourceCwd).isDirectory()) {
    throw new Error(`Source workspace is not a directory: ${sourceCwd}`);
  }
  for (const entry of readdirSync(sourceCwd, { withFileTypes: true })) {
    cpSync(join(sourceCwd, entry.name), join(destinationCwd, entry.name), {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
  }
}

/**
 * Remove a browser-created draft only when it still contains no transcript or
 * workspace files. Callers must separately ensure that no live RPC session is
 * using the workspace.
 */
export function discardPristineManagedSessionWorkspace(workspace: string): boolean {
  const paths = managedSessionFromWorkspace(workspace);
  if (!paths) return false;

  const sessionEntries = readdirSync(paths.sessionRoot, { withFileTypes: true });
  if (sessionEntries.some((entry) => entry.name !== "meta.json" && entry.name !== "workspace")) {
    return false;
  }
  if (readdirSync(paths.workspace).length > 0) return false;

  removeManagedSessionRoot(paths);
  return true;
}

export function removeManagedSessionRoot(paths: ManagedSessionPaths): void {
  const expected = pathsForSessionId(paths.sessionId);
  if (resolve(expected.sessionRoot) !== resolve(paths.sessionRoot)) {
    throw new Error("Refusing to remove an unexpected managed session path");
  }
  rmSync(paths.sessionRoot, { recursive: true, force: false });
}
