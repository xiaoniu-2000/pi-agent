import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const subject = await jiti.import("./managed-session-workspace.ts");

test("allocates, resolves, copies, and removes one directory per managed session", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-managed-sessions-"));
  const previousRoot = process.env.PI_WEB_USER_DATA_ROOT;
  const previousUser = process.env.PI_WEB_FIXED_USER_ID;
  process.env.PI_WEB_USER_DATA_ROOT = root;
  process.env.PI_WEB_FIXED_USER_ID = "user1";

  t.after(() => {
    if (previousRoot === undefined) delete process.env.PI_WEB_USER_DATA_ROOT;
    else process.env.PI_WEB_USER_DATA_ROOT = previousRoot;
    if (previousUser === undefined) delete process.env.PI_WEB_FIXED_USER_ID;
    else process.env.PI_WEB_FIXED_USER_ID = previousUser;
    rmSync(root, { recursive: true, force: true });
  });

  const first = subject.allocateManagedSessionWorkspace();
  assert.equal(first.userRoot, join(root, "user1"));
  assert.equal(first.workspace, join(first.sessionRoot, "workspace"));
  assert.deepEqual(subject.managedSessionFromWorkspace(first.workspace), first);
  assert.equal(subject.managedSessionFromWorkspace(first.sessionRoot), null);

  const meta = JSON.parse(readFileSync(join(first.sessionRoot, "meta.json"), "utf8"));
  assert.equal(meta.userId, "user1");
  assert.equal(meta.sessionId, first.sessionId);
  assert.match(meta.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/);
  assert.equal(
    subject.toBeijingISOString(new Date("2026-08-18T02:49:30.684Z")),
    "2026-08-18T10:49:30.684+08:00",
  );

  writeFileSync(join(first.workspace, "generated.txt"), "session-owned content");
  const second = subject.allocateManagedSessionWorkspace();
  subject.copyManagedWorkspace(first.workspace, second.workspace);
  assert.equal(
    readFileSync(join(second.workspace, "generated.txt"), "utf8"),
    "session-owned content",
  );
  assert.equal(subject.discardPristineManagedSessionWorkspace(second.workspace), false);

  const pristine = subject.allocateManagedSessionWorkspace();
  assert.equal(subject.discardPristineManagedSessionWorkspace(pristine.workspace), true);
  assert.equal(existsSync(pristine.sessionRoot), false);

  const transcript = join(first.sessionRoot, `test_${first.sessionId}.jsonl`);
  writeFileSync(transcript, "{}\n");
  assert.deepEqual(subject.managedSessionFromFile(transcript), first);
  assert.deepEqual(subject.listManagedSessionFiles(), [transcript]);

  subject.removeManagedSessionRoot(first);
  assert.equal(existsSync(first.sessionRoot), false);
  assert.equal(existsSync(second.sessionRoot), true);

  const third = subject.allocateManagedSessionWorkspace();
  rmSync(third.workspace, { recursive: true });
  const outside = join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, third.workspace, process.platform === "win32" ? "junction" : "dir");
  assert.equal(subject.managedSessionFromWorkspace(third.workspace), null);
});

test("rejects unsafe fixed user ids", () => {
  const previousRoot = process.env.PI_WEB_USER_DATA_ROOT;
  const previousUser = process.env.PI_WEB_FIXED_USER_ID;
  process.env.PI_WEB_USER_DATA_ROOT = join(tmpdir(), "pi-web-managed-root");
  process.env.PI_WEB_FIXED_USER_ID = "../escape";

  try {
    assert.throws(() => subject.getManagedUserRoot(), /PI_WEB_FIXED_USER_ID/);
  } finally {
    if (previousRoot === undefined) delete process.env.PI_WEB_USER_DATA_ROOT;
    else process.env.PI_WEB_USER_DATA_ROOT = previousRoot;
    if (previousUser === undefined) delete process.env.PI_WEB_FIXED_USER_ID;
    else process.env.PI_WEB_FIXED_USER_ID = previousUser;
  }
});

test("keeps authenticated users in separate managed roots", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-managed-users-"));
  const previousRoot = process.env.PI_WEB_USER_DATA_ROOT;
  process.env.PI_WEB_USER_DATA_ROOT = root;
  t.after(() => {
    if (previousRoot === undefined) delete process.env.PI_WEB_USER_DATA_ROOT;
    else process.env.PI_WEB_USER_DATA_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  });

  const first = subject.allocateManagedSessionWorkspace("user1");
  const second = subject.allocateManagedSessionWorkspace("user2");

  assert.equal(first.userRoot, join(root, "user1"));
  assert.equal(second.userRoot, join(root, "user2"));
  assert.equal(subject.managedSessionFromWorkspace(first.workspace, "user2"), null);
  assert.equal(subject.managedSessionFromWorkspace(second.workspace, "user1"), null);
  assert.deepEqual(subject.listManagedSessionRoots("user1"), [first.sessionRoot]);
  assert.deepEqual(subject.listManagedSessionRoots("user2"), [second.sessionRoot]);
});
