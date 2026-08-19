import { NextResponse, type NextRequest } from "next/server";
import {
  getCorsAllowOrigin,
  isApiRequestOriginAllowed,
  shouldCheckApiRequestOrigin,
} from "@/lib/request-security";

const ALLOW_METHODS = "GET,POST,PATCH,PUT,DELETE,OPTIONS";
const ALLOW_HEADERS = "Content-Type,Authorization,Last-Event-ID";

function appendCorsHeaders(response: NextResponse, allowOrigin: string | null): NextResponse {
  if (!allowOrigin) return response;
  response.headers.set("Access-Control-Allow-Origin", allowOrigin);
  response.headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
  response.headers.set(
    "Access-Control-Expose-Headers",
    "Content-Disposition,Content-Length,Content-Range,Accept-Ranges",
  );
  response.headers.append("Vary", "Origin");
  return response;
}

export function proxy(request: NextRequest) {
  if (shouldCheckApiRequestOrigin(request) && !isApiRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Cross-origin API requests are not allowed" }, { status: 403 });
  }

  const allowOrigin = getCorsAllowOrigin(request);
  if (request.method === "OPTIONS") {
    return appendCorsHeaders(new NextResponse(null, { status: 204 }), allowOrigin);
  }
  return appendCorsHeaders(NextResponse.next(), allowOrigin);
}

export const config = { matcher: "/api/:path*" };
