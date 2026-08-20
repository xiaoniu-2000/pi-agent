import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const auth = await jiti.import("./web-auth.ts");

test("authenticates passwords and invalidates signed sessions after a password change", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-auth-"));
  const previous = {
    enabled: process.env.PI_WEB_AUTH_ENABLED,
    agentDir: process.env.PI_CODING_AGENT_DIR,
  };
  process.env.PI_WEB_AUTH_ENABLED = "1";
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (previous.enabled === undefined) delete process.env.PI_WEB_AUTH_ENABLED;
    else process.env.PI_WEB_AUTH_ENABLED = previous.enabled;
    if (previous.agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous.agentDir;
    auth.clearWebUserStoreCache();
    rmSync(root, { recursive: true, force: true });
  });

  const passwordHash = await auth.hashWebPassword("correct horse battery staple");
  const user = {
    id: "user1",
    displayName: "测试用户",
    passwordHash,
    role: "admin",
    sessionVersion: 1,
  };
  writeFileSync(join(root, "web-users.json"), `${JSON.stringify({ version: 1, users: [user] })}\n`);
  auth.clearWebUserStoreCache();

  assert.equal(await auth.authenticateWebCredentials("user1", "wrong password"), null);
  assert.deepEqual(await auth.authenticateWebCredentials("user1", "correct horse battery staple"), {
    id: "user1",
    displayName: "测试用户",
    role: "admin",
  });

  const token = auth.createWebSessionToken("user1");
  const request = new Request("http://localhost/api/account/me", {
    headers: { cookie: `pi_web_session=${token}` },
  });
  assert.equal(auth.authenticateWebRequest(request)?.id, "user1");
  assert.equal(auth.authenticateWebRequest(new Request("http://localhost", {
    headers: { cookie: `pi_web_session=${token}x` },
  })), null);

  user.sessionVersion = 2;
  writeFileSync(join(root, "web-users.json"), `${JSON.stringify({ version: 1, users: [user] })}\n`);
  auth.clearWebUserStoreCache();
  assert.equal(auth.authenticateWebRequest(request), null);
});

test("self-registration creates only normal users and preserves the administrator", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-register-"));
  const previous = {
    enabled: process.env.PI_WEB_AUTH_ENABLED,
    registration: process.env.PI_WEB_SELF_REGISTRATION_ENABLED,
    agentDir: process.env.PI_CODING_AGENT_DIR,
  };
  process.env.PI_WEB_AUTH_ENABLED = "1";
  process.env.PI_WEB_SELF_REGISTRATION_ENABLED = "1";
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (previous.enabled === undefined) delete process.env.PI_WEB_AUTH_ENABLED;
    else process.env.PI_WEB_AUTH_ENABLED = previous.enabled;
    if (previous.registration === undefined) delete process.env.PI_WEB_SELF_REGISTRATION_ENABLED;
    else process.env.PI_WEB_SELF_REGISTRATION_ENABLED = previous.registration;
    if (previous.agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous.agentDir;
    auth.clearWebUserStoreCache();
    rmSync(root, { recursive: true, force: true });
  });

  const administrator = {
    id: "user1",
    displayName: "user1",
    passwordHash: await auth.hashWebPassword("administrator-password"),
    role: "admin",
    sessionVersion: 1,
  };
  writeFileSync(
    join(root, "web-users.json"),
    `${JSON.stringify({ version: 1, users: [administrator] })}\n`,
    { mode: 0o600 },
  );
  auth.clearWebUserStoreCache();

  assert.deepEqual(await auth.registerWebUser("new-user", "new-user-password"), {
    id: "new-user",
    displayName: "new-user",
    role: "user",
  });
  assert.deepEqual(await auth.authenticateWebCredentials("new-user", "new-user-password"), {
    id: "new-user",
    displayName: "new-user",
    role: "user",
  });
  await assert.rejects(
    () => auth.registerWebUser("new-user", "another-password"),
    auth.WebUserAlreadyExistsError,
  );

  const stored = auth.loadWebUserStore();
  assert.equal(stored.users.find((candidate) => candidate.id === "user1")?.role, "admin");
  assert.equal(stored.users.find((candidate) => candidate.id === "new-user")?.role, "user");
});
