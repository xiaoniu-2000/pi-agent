#!/usr/bin/env node

import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const scrypt = promisify(scryptCallback);
const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const usersFile = path.resolve(
  process.env.PI_WEB_USERS_FILE
    || path.join(process.env.PI_CODING_AGENT_DIR || path.join(projectDir, "runtime", "pi-agent"), "web-users.json"),
);

function usage() {
  console.error(`Usage:
  node scripts/manage-web-user.mjs list
  node scripts/manage-web-user.mjs set <user-id> [--admin] [--display-name <name>] [--password-stdin]
  node scripts/manage-web-user.mjs enable <user-id>
  node scripts/manage-web-user.mjs disable <user-id>`);
  process.exitCode = 2;
}

async function loadStore() {
  try {
    const parsed = JSON.parse(await readFile(usersFile, "utf8"));
    if (parsed.version !== 1 || !Array.isArray(parsed.users)) throw new Error("invalid schema");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, users: [] };
    throw new Error(`Unable to read ${usersFile}: ${error.message}`);
  }
}

async function saveStore(store) {
  await mkdir(path.dirname(usersFile), { recursive: true, mode: 0o700 });
  const temporary = `${usersFile}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, usersFile);
}

async function hiddenPrompt(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive password input requires a TTY; use --password-stdin instead");
  }
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") return finish(new Error("Cancelled"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function stdinPassword() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value.replace(/[\r\n]+$/, "");
}

async function passwordHash(password) {
  if (password.length < 8 || password.length > 256) {
    throw new Error("Password must contain between 8 and 256 characters");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return ["scrypt", "16384", "8", "1", salt.toString("base64url"), derived.toString("base64url")].join("$");
}

const [command, userId, ...options] = process.argv.slice(2);
if (!command) {
  usage();
} else if (command === "list") {
  const store = await loadStore();
  if (store.users.length === 0) console.log(`No users configured in ${usersFile}`);
  for (const user of store.users) {
    console.log(`${user.id}\t${user.role || "user"}\t${user.disabled ? "disabled" : "enabled"}\t${user.displayName || user.id}`);
  }
} else if (["set", "enable", "disable"].includes(command)) {
  if (!userId || !USER_ID_PATTERN.test(userId)) {
    throw new Error("A valid user ID is required (letters, numbers, '.', '_' and '-' only; maximum 64 characters)");
  }
  const store = await loadStore();
  const index = store.users.findIndex((candidate) => candidate.id === userId);
  const existing = index >= 0 ? store.users[index] : null;

  if (command === "set") {
    const admin = options.includes("--admin") || (!existing && store.users.length === 0);
    const passwordFromStdin = options.includes("--password-stdin");
    const displayNameIndex = options.indexOf("--display-name");
    const displayName = displayNameIndex >= 0 ? options[displayNameIndex + 1]?.trim() : existing?.displayName;
    let password;
    if (passwordFromStdin) {
      password = await stdinPassword();
    } else {
      password = await hiddenPrompt("Password: ");
      const confirmation = await hiddenPrompt("Confirm password: ");
      if (password !== confirmation) throw new Error("Passwords do not match");
    }
    const next = {
      id: userId,
      displayName: displayName || userId,
      passwordHash: await passwordHash(password),
      role: admin ? "admin" : (existing?.role || "user"),
      disabled: false,
      sessionVersion: (existing?.sessionVersion || 0) + 1,
    };
    if (index >= 0) store.users[index] = next;
    else store.users.push(next);
    await saveStore(store);
    console.log(`${existing ? "Updated" : "Created"} ${userId} in ${usersFile}`);
  } else {
    if (!existing) throw new Error(`Unknown user: ${userId}`);
    existing.disabled = command === "disable";
    existing.sessionVersion = (existing.sessionVersion || 0) + 1;
    await saveStore(store);
    console.log(`${command === "disable" ? "Disabled" : "Enabled"} ${userId}`);
  }
} else {
  usage();
}
