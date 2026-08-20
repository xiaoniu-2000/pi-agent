import { NextResponse, type NextRequest } from "next/server";
import {
  getCorsAllowOrigin,
  isApiRequestOriginAllowed,
  shouldCheckApiRequestOrigin,
} from "@/lib/request-security";
import {
  AUTH_USER_ID_HEADER,
  AUTH_USER_ROLE_HEADER,
  authenticateWebRequest,
} from "@/lib/web-auth";

const ALLOW_METHODS = "GET,POST,PATCH,PUT,DELETE,OPTIONS";
const ALLOW_HEADERS = "Content-Type,Authorization,Last-Event-ID";

function appendCorsHeaders(response: NextResponse, allowOrigin: string | null): NextResponse {
  if (!allowOrigin) return response;
  response.headers.set("Access-Control-Allow-Origin", allowOrigin);
  if (allowOrigin !== "*") response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
  response.headers.set(
    "Access-Control-Expose-Headers",
    "Content-Disposition,Content-Length,Content-Range,Accept-Ranges",
  );
  response.headers.append("Vary", "Origin");
  return response;
}

function mayAccessWithoutSession(pathname: string): boolean {
  return pathname === "/api/health"
    || pathname === "/api/account/login"
    || pathname === "/api/account/register"
    || pathname === "/api/account/me"
    || pathname === "/api/account/logout";
}

function requiresAdministrator(pathname: string): boolean {
  return pathname === "/api/models-config"
    || pathname.startsWith("/api/models-config/")
    || pathname === "/api/auth"
    || pathname.startsWith("/api/auth/")
    || pathname === "/api/skills"
    || pathname.startsWith("/api/skills/")
    || pathname === "/api/plugins"
    || pathname.startsWith("/api/plugins/");
}

export function proxy(request: NextRequest) {
  if (shouldCheckApiRequestOrigin(request) && !isApiRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Cross-origin API requests are not allowed" }, { status: 403 });
  }

  const allowOrigin = getCorsAllowOrigin(request);
  if (request.method === "OPTIONS") {
    return appendCorsHeaders(new NextResponse(null, { status: 204 }), allowOrigin);
  }

  const requestHeaders = new Headers(request.headers);
  // Never trust identity headers supplied by the browser or a direct client.
  requestHeaders.delete(AUTH_USER_ID_HEADER);
  requestHeaders.delete(AUTH_USER_ROLE_HEADER);

  if (!mayAccessWithoutSession(request.nextUrl.pathname)) {
    const user = authenticateWebRequest(request);
    if (!user) {
      return appendCorsHeaders(
        NextResponse.json({ error: "Authentication required" }, { status: 401 }),
        allowOrigin,
      );
    }
    if (requiresAdministrator(request.nextUrl.pathname) && user.role !== "admin") {
      return appendCorsHeaders(
        NextResponse.json({ error: "Administrator access required" }, { status: 403 }),
        allowOrigin,
      );
    }
    requestHeaders.set(AUTH_USER_ID_HEADER, user.id);
    requestHeaders.set(AUTH_USER_ROLE_HEADER, user.role);
  }

  return appendCorsHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    allowOrigin,
  );
}

export const config = { matcher: "/api/:path*" };
