import { NextResponse } from "next/server";
import {
  WebAuthConfigurationError,
  WebUserAlreadyExistsError,
  WebUserLimitError,
  buildWebSessionCookie,
  createWebSessionToken,
  isSelfRegistrationEnabled,
  registerWebUser,
  validateWebUserId,
} from "@/lib/web-auth";

interface RegistrationBucket {
  count: number;
  resetAt: number;
}

declare global {
  var __piWebRegistrations: Map<string, RegistrationBucket> | undefined;
}

const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
const MAX_REGISTRATIONS_PER_ADDRESS = 10;

function registrationBuckets(): Map<string, RegistrationBucket> {
  if (!globalThis.__piWebRegistrations) globalThis.__piWebRegistrations = new Map();
  return globalThis.__piWebRegistrations;
}

function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

export async function POST(request: Request) {
  if (!isSelfRegistrationEnabled()) {
    return NextResponse.json({ error: "当前未开放新账号注册" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { userId?: unknown; password?: unknown } | null;
  if (typeof body?.userId !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "请输入有效的账号和密码" }, { status: 400 });
  }
  let userId: string;
  try {
    userId = validateWebUserId(body.userId);
  } catch {
    return NextResponse.json(
      { error: "账号仅支持字母、数字、点、下划线和短横线，最多 64 个字符" },
      { status: 400 },
    );
  }
  if (body.password.length < 8 || body.password.length > 256) {
    return NextResponse.json({ error: "密码长度需要为 8–256 个字符" }, { status: 400 });
  }

  const buckets = registrationBuckets();
  const address = clientAddress(request);
  const now = Date.now();
  const current = buckets.get(address);
  if (current && current.resetAt > now && current.count >= MAX_REGISTRATIONS_PER_ADDRESS) {
    return NextResponse.json(
      { error: "注册次数过多，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((current.resetAt - now) / 1000)) } },
    );
  }
  if (!current || current.resetAt <= now) {
    buckets.set(address, { count: 0, resetAt: now + REGISTRATION_WINDOW_MS });
  }

  try {
    const user = await registerWebUser(userId, body.password);
    const bucket = buckets.get(address);
    if (bucket) bucket.count += 1;
    const response = NextResponse.json({ user }, { status: 201 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.append("Set-Cookie", buildWebSessionCookie(request, createWebSessionToken(user.id)));
    return response;
  } catch (error) {
    if (error instanceof WebUserAlreadyExistsError) {
      return NextResponse.json({ error: "该账号已存在，请直接登录" }, { status: 409 });
    }
    if (error instanceof WebUserLimitError) {
      return NextResponse.json({ error: "账号数量已达上限，请联系管理员" }, { status: 409 });
    }
    if (error instanceof WebAuthConfigurationError) {
      return NextResponse.json({ error: "注册服务暂时不可用，请联系管理员" }, { status: 503 });
    }
    return NextResponse.json({ error: "注册失败，请稍后重试" }, { status: 500 });
  }
}
