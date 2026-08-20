import { NextResponse } from "next/server";
import {
  WebAuthConfigurationError,
  authenticateWebCredentials,
  buildWebSessionCookie,
  createWebSessionToken,
  isWebAuthEnabled,
  validateWebUserId,
} from "@/lib/web-auth";

interface FailureBucket {
  failures: number;
  blockedUntil: number;
  lastFailure: number;
}

declare global {
  var __piWebLoginFailures: Map<string, FailureBucket> | undefined;
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

function failureBuckets(): Map<string, FailureBucket> {
  if (!globalThis.__piWebLoginFailures) globalThis.__piWebLoginFailures = new Map();
  return globalThis.__piWebLoginFailures;
}

function pruneFailureBuckets(buckets: Map<string, FailureBucket>, now: number): void {
  if (buckets.size < 5_000) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastFailure > WINDOW_MS && bucket.blockedUntil <= now) buckets.delete(key);
  }
  while (buckets.size >= 5_000) {
    const oldestKey = buckets.keys().next().value as string | undefined;
    if (!oldestKey) break;
    buckets.delete(oldestKey);
  }
}

function clientKey(request: Request, userId: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return `${address}\n${userId}`;
}

export async function POST(request: Request) {
  if (!isWebAuthEnabled()) {
    return NextResponse.json({ error: "Web authentication is disabled" }, { status: 409 });
  }

  const body = await request.json().catch(() => null) as { userId?: unknown; password?: unknown } | null;
  if (
    typeof body?.userId !== "string"
    || typeof body.password !== "string"
    || body.userId.length > 64
    || body.password.length > 256
  ) {
    return NextResponse.json({ error: "登录失败，账号或密码错误" }, { status: 400 });
  }

  let userId: string;
  try {
    userId = validateWebUserId(body.userId);
  } catch {
    return NextResponse.json({ error: "登录失败，账号或密码错误" }, { status: 400 });
  }

  const key = clientKey(request, userId);
  const buckets = failureBuckets();
  const now = Date.now();
  pruneFailureBuckets(buckets, now);
  const bucket = buckets.get(key);
  if (bucket?.blockedUntil && bucket.blockedUntil > now) {
    return NextResponse.json(
      { error: "登录失败次数过多，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((bucket.blockedUntil - now) / 1000)) } },
    );
  }
  if (bucket && now - bucket.lastFailure > WINDOW_MS) buckets.delete(key);

  try {
    const user = await authenticateWebCredentials(userId, body.password);
    if (!user) {
      const current = buckets.get(key);
      const failures = (current?.failures ?? 0) + 1;
      buckets.set(key, {
        failures,
        lastFailure: now,
        blockedUntil: failures >= MAX_FAILURES ? now + WINDOW_MS : 0,
      });
      return NextResponse.json({ error: "登录失败，账号或密码错误" }, { status: 401 });
    }

    buckets.delete(key);
    const response = NextResponse.json({ user });
    response.headers.set("Cache-Control", "no-store");
    response.headers.append("Set-Cookie", buildWebSessionCookie(request, createWebSessionToken(user.id)));
    return response;
  } catch (error) {
    if (error instanceof WebAuthConfigurationError) {
      return NextResponse.json({ error: "登录服务暂时不可用，请稍后重试" }, { status: 503 });
    }
    return NextResponse.json({ error: "登录服务暂时不可用" }, { status: 500 });
  }
}
