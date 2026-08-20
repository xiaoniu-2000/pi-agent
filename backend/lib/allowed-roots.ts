// In-memory roots that should be browsable in addition to roots derived from
// persisted sessions. Stored on globalThis so Next.js hot-reload keeps them.
declare global {
  var __piAllowedRootsCaches: Map<string, { roots: Set<string>; expiresAt: number }> | undefined;
  var __piAdditionalAllowedRootsByUser: Map<string, Set<string>> | undefined;
}

export function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function userKey(userId?: string): string {
  return userId || "__legacy__";
}

export function getAdditionalAllowedRoots(userId?: string): Set<string> {
  if (!globalThis.__piAdditionalAllowedRootsByUser) {
    globalThis.__piAdditionalAllowedRootsByUser = new Map();
  }
  const key = userKey(userId);
  let roots = globalThis.__piAdditionalAllowedRootsByUser.get(key);
  if (!roots) {
    roots = new Set();
    globalThis.__piAdditionalAllowedRootsByUser.set(key, roots);
  }
  return roots;
}

export function allowFileRoot(root: string, userId?: string): void {
  if (!root) return;
  const normalizedRoot = normalizeSlashes(root);
  getAdditionalAllowedRoots(userId).add(normalizedRoot);
  globalThis.__piAllowedRootsCaches?.get(userKey(userId))?.roots.add(normalizedRoot);
}
