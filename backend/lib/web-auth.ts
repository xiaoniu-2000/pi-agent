import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolvePromise(derivedKey);
    });
  });
}

const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COOKIE_NAME = "pi_web_session";
const SESSION_VERSION = 1;
const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

export const AUTH_USER_ID_HEADER = "x-pi-web-auth-user-id";
export const AUTH_USER_ROLE_HEADER = "x-pi-web-auth-user-role";

export type WebUserRole = "admin" | "user";

export interface StoredWebUser {
  id: string;
  displayName?: string;
  passwordHash: string;
  role?: WebUserRole;
  disabled?: boolean;
  sessionVersion?: number;
}

export interface WebUserStore {
  version: 1;
  users: StoredWebUser[];
}

export interface AuthenticatedWebUser {
  id: string;
  displayName: string;
  role: WebUserRole;
}

interface SessionPayload {
  v: number;
  sub: string;
  sv: number;
  iat: number;
  exp: number;
}

declare global {
  var __piWebUsersCache: {
    path: string;
    mtimeMs: number;
    size: number;
    store: WebUserStore;
  } | undefined;
  var __piWebUserMutationQueue: Promise<void> | undefined;
}

export class WebAuthConfigurationError extends Error {}
export class WebAuthRequiredError extends Error {}
export class WebUserAlreadyExistsError extends Error {}
export class WebUserLimitError extends Error {}

export function isWebAuthEnabled(): boolean {
  return process.env.PI_WEB_AUTH_ENABLED === "1";
}

export function isSelfRegistrationEnabled(): boolean {
  return isWebAuthEnabled() && process.env.PI_WEB_SELF_REGISTRATION_ENABLED !== "0";
}

function agentDataDirectory(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  return resolve(configured || join(process.cwd(), "runtime", "pi-agent"));
}

export function getWebUsersFilePath(): string {
  const configured = process.env.PI_WEB_USERS_FILE?.trim();
  return resolve(configured || join(agentDataDirectory(), "web-users.json"));
}

function getSessionSecretFilePath(): string {
  const configured = process.env.PI_WEB_SESSION_SECRET_FILE?.trim();
  return resolve(configured || join(agentDataDirectory(), "web-session-secret"));
}

export function validateWebUserId(value: string): string {
  const userId = value.trim();
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error(
      "User ID must start with a letter or number and contain only letters, numbers, '.', '_' or '-' (maximum 64 characters)",
    );
  }
  return userId;
}

function normalizeStoredUser(value: unknown): StoredWebUser {
  if (!value || typeof value !== "object") {
    throw new WebAuthConfigurationError("Invalid user entry in web-users.json");
  }
  const candidate = value as Partial<StoredWebUser>;
  const id = validateWebUserId(String(candidate.id ?? ""));
  if (typeof candidate.passwordHash !== "string" || !candidate.passwordHash) {
    throw new WebAuthConfigurationError(`Missing password hash for user ${id}`);
  }
  const role = candidate.role ?? "user";
  if (role !== "admin" && role !== "user") {
    throw new WebAuthConfigurationError(`Invalid role for user ${id}`);
  }
  return {
    id,
    displayName: typeof candidate.displayName === "string" && candidate.displayName.trim()
      ? candidate.displayName.trim().slice(0, 100)
      : id,
    passwordHash: candidate.passwordHash,
    role,
    disabled: candidate.disabled === true,
    sessionVersion: Number.isSafeInteger(candidate.sessionVersion) && Number(candidate.sessionVersion) > 0
      ? Number(candidate.sessionVersion)
      : 1,
  };
}

export function loadWebUserStore(): WebUserStore {
  const path = getWebUsersFilePath();
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new WebAuthConfigurationError(
      `No web user database found at ${path}. Create the first account with the bundled manage-web-user script.`,
    );
  }

  const cached = globalThis.__piWebUsersCache;
  if (
    cached
    && cached.path === path
    && cached.mtimeMs === stat.mtimeMs
    && cached.size === stat.size
  ) {
    return cached.store;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new WebAuthConfigurationError(
      `Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const candidate = parsed as Partial<WebUserStore>;
  if (candidate.version !== 1 || !Array.isArray(candidate.users)) {
    throw new WebAuthConfigurationError("web-users.json must contain version 1 and a users array");
  }

  const users = candidate.users.map(normalizeStoredUser);
  const seen = new Set<string>();
  for (const user of users) {
    if (seen.has(user.id)) {
      throw new WebAuthConfigurationError(`Duplicate user ID in web-users.json: ${user.id}`);
    }
    seen.add(user.id);
  }

  const store: WebUserStore = { version: 1, users };
  globalThis.__piWebUsersCache = {
    path,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    store,
  };
  return store;
}

export function clearWebUserStoreCache(): void {
  globalThis.__piWebUsersCache = undefined;
}

function maximumWebUsers(): number {
  const configured = Number(process.env.PI_WEB_MAX_USERS ?? "500");
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 10_000
    ? configured
    : 500;
}

async function withWebUserMutation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = globalThis.__piWebUserMutationQueue ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  globalThis.__piWebUserMutationQueue = previous.catch(() => {}).then(() => gate);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
  }
}

function writeWebUserStore(store: WebUserStore): void {
  const path = getWebUsersFilePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, path);
  clearWebUserStoreCache();
}

/** Create a normal user. The initial administrator must be provisioned by the CLI. */
export async function registerWebUser(
  userIdInput: string,
  password: string,
): Promise<AuthenticatedWebUser> {
  if (!isSelfRegistrationEnabled()) {
    throw new WebAuthConfigurationError("Self-registration is disabled");
  }
  const id = validateWebUserId(userIdInput);
  return withWebUserMutation(async () => {
    const store = loadWebUserStore();
    if (store.users.some((candidate) => candidate.id === id)) {
      throw new WebUserAlreadyExistsError("User already exists");
    }
    if (store.users.length >= maximumWebUsers()) {
      throw new WebUserLimitError("User limit reached");
    }
    const user: StoredWebUser = {
      id,
      displayName: id,
      passwordHash: await hashWebPassword(password),
      role: "user",
      disabled: false,
      sessionVersion: 1,
    };
    writeWebUserStore({ version: 1, users: [...store.users, user] });
    return publicUser(user);
  });
}

function publicUser(user: StoredWebUser): AuthenticatedWebUser {
  return {
    id: user.id,
    displayName: user.displayName || user.id,
    role: user.role ?? "user",
  };
}

function legacyUser(): AuthenticatedWebUser {
  const id = validateWebUserId(process.env.PI_WEB_FIXED_USER_ID?.trim() || "user1");
  return { id, displayName: id, role: "admin" };
}

export async function hashWebPassword(password: string): Promise<string> {
  if (password.length < 8 || password.length > 256) {
    throw new Error("Password must contain between 8 and 256 characters");
  }
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyWebPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, nValue, rValue, pValue, saltValue, hashValue, ...extra] = encoded.split("$");
  if (algorithm !== "scrypt" || extra.length > 0 || !saltValue || !hashValue) return false;
  const N = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;

  let expected: Buffer;
  let salt: Buffer;
  try {
    expected = Buffer.from(hashValue, "base64url");
    salt = Buffer.from(saltValue, "base64url");
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEY_LENGTH || salt.length < 16) return false;

  const actual = await scryptAsync(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummyPasswordHashPromise: Promise<string> | undefined;

export async function authenticateWebCredentials(
  userIdInput: string,
  password: string,
): Promise<AuthenticatedWebUser | null> {
  if (!isWebAuthEnabled()) return legacyUser();
  const userId = userIdInput.trim();
  const store = loadWebUserStore();
  const user = store.users.find((candidate) => candidate.id === userId);

  // Perform the same expensive operation for unknown users to reduce account enumeration.
  const hash = user?.passwordHash
    ?? await (dummyPasswordHashPromise ??= hashWebPassword(randomBytes(24).toString("base64url")));
  const valid = await verifyWebPassword(password, hash);
  if (!user || user.disabled || !valid) return null;
  return publicUser(user);
}

function sessionTtlSeconds(): number {
  const hours = Number(process.env.PI_WEB_SESSION_TTL_HOURS ?? "12");
  if (!Number.isFinite(hours) || hours < 0.25 || hours > 24 * 30) {
    return DEFAULT_SESSION_TTL_SECONDS;
  }
  return Math.floor(hours * 60 * 60);
}

function readOrCreateSessionSecret(): Buffer {
  const path = getSessionSecretFilePath();
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, `${randomBytes(48).toString("base64url")}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
    }
  }
  const secret = readFileSync(path, "utf8").trim();
  if (secret.length < 32) {
    throw new WebAuthConfigurationError(`Session secret at ${path} is invalid`);
  }
  return Buffer.from(secret, "utf8");
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", readOrCreateSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createWebSessionToken(userId: string): string {
  const store = loadWebUserStore();
  const user = store.users.find((candidate) => candidate.id === userId && !candidate.disabled);
  if (!user) throw new WebAuthConfigurationError(`Unknown or disabled web user: ${userId}`);
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    sub: user.id,
    sv: user.sessionVersion ?? 1,
    iat: now,
    exp: now + sessionTtlSeconds(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signPayload(encoded)}`;
}

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies.set(name, value);
  }
  return cookies;
}

function verifyWebSessionToken(token: string): AuthenticatedWebUser | null {
  const separator = token.indexOf(".");
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = signPayload(encoded);
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    actualBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.v !== SESSION_VERSION
    || !USER_ID_PATTERN.test(payload.sub)
    || !Number.isSafeInteger(payload.sv)
    || !Number.isSafeInteger(payload.iat)
    || !Number.isSafeInteger(payload.exp)
    || payload.iat > now + 60
    || payload.exp <= now
  ) {
    return null;
  }

  const user = loadWebUserStore().users.find((candidate) => candidate.id === payload.sub);
  if (!user || user.disabled || (user.sessionVersion ?? 1) !== payload.sv) return null;
  return publicUser(user);
}

export function authenticateWebRequest(request: Request): AuthenticatedWebUser | null {
  if (!isWebAuthEnabled()) return legacyUser();
  const token = parseCookies(request.headers.get("cookie")).get(COOKIE_NAME);
  if (!token) return null;
  try {
    return verifyWebSessionToken(token);
  } catch {
    return null;
  }
}

export function getRequestWebUser(request: Request): AuthenticatedWebUser {
  const trustedUserId = request.headers.get(AUTH_USER_ID_HEADER);
  if (trustedUserId) {
    const id = validateWebUserId(trustedUserId);
    const role = request.headers.get(AUTH_USER_ROLE_HEADER) === "admin" ? "admin" : "user";
    return { id, displayName: id, role };
  }
  if (!isWebAuthEnabled()) return legacyUser();
  throw new WebAuthRequiredError("Authentication required");
}

function cookiePath(): string {
  const configured = process.env.PI_WEB_COOKIE_PATH?.trim();
  if (!configured || !configured.startsWith("/")) return "/";
  return configured;
}

function shouldUseSecureCookie(request: Request): boolean {
  const configured = process.env.PI_WEB_COOKIE_SECURE;
  if (configured === "1") return true;
  if (configured === "0") return false;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded === "https" || new URL(request.url).protocol === "https:";
}

export function buildWebSessionCookie(request: Request, token: string): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${sessionTtlSeconds()}`,
    `Path=${cookiePath()}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (shouldUseSecureCookie(request)) parts.push("Secure");
  return parts.join("; ");
}

export function buildExpiredWebSessionCookie(request: Request): string {
  const parts = [
    `${COOKIE_NAME}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    `Path=${cookiePath()}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (shouldUseSecureCookie(request)) parts.push("Secure");
  return parts.join("; ");
}

export function getWebAuthStatus(): { enabled: boolean; configured: boolean; users: number; selfRegistration: boolean } {
  if (!isWebAuthEnabled()) return { enabled: false, configured: true, users: 1, selfRegistration: false };
  try {
    const store = loadWebUserStore();
    return {
      enabled: true,
      configured: true,
      users: store.users.filter((user) => !user.disabled).length,
      selfRegistration: isSelfRegistrationEnabled(),
    };
  } catch {
    return { enabled: true, configured: false, users: 0, selfRegistration: isSelfRegistrationEnabled() };
  }
}
