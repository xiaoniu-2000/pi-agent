function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function configuredOrigins(): string[] {
  return (process.env.PI_WEB_CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getCorsAllowOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const requestOrigin = getRequestOrigin(request);
  const canonical = canonicalOrigin(origin);
  if (canonical && canonical === requestOrigin) return origin;

  const allowed = configuredOrigins();
  if (allowed.includes("*")) return "*";
  return canonical && allowed.some((value) => canonicalOrigin(value) === canonical)
    ? origin
    : null;
}

function getRequestOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  return host ? canonicalOrigin(`${requestUrl.protocol}//${host}`) : requestUrl.origin;
}

/** Reject browser cross-site API requests while preserving non-browser clients. */
export function isApiRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin && request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (!origin) return true;
  return getCorsAllowOrigin(request) !== null;
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}
