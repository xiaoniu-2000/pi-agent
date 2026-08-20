declare global {
  interface Window {
    PI_WEB_CONFIG?: { apiBaseUrl?: string };
    __PI_WEB_API_BRIDGE_INSTALLED__?: boolean;
  }
}

function configuredApiBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const runtimeValue = window.PI_WEB_CONFIG?.apiBaseUrl?.trim();
  const queryValue = new URLSearchParams(window.location.search).get("apiUrl")?.trim();
  return (queryValue || runtimeValue || "").replace(/\/+$/, "");
}

function isBackendApiUrl(value: string): boolean {
  if (value.startsWith("/api/")) return true;
  const baseUrl = configuredApiBaseUrl();
  return Boolean(baseUrl && value.startsWith(`${baseUrl}/api/`));
}

function isPublicAccountUrl(value: string): boolean {
  try {
    const pathname = new URL(value, window.location.href).pathname;
    return pathname === "/api/account/login"
      || pathname === "/api/account/register"
      || pathname === "/api/account/me";
  } catch {
    return false;
  }
}

export function apiUrl(input: string): string {
  if (!input.startsWith("/api/")) return input;
  return `${configuredApiBaseUrl()}${input}`;
}

/**
 * Keep the upstream UI source largely intact: all relative /api fetch and SSE
 * calls are redirected to the independently deployed backend at runtime.
 */
export function installApiBridge(): void {
  if (typeof window === "undefined" || window.__PI_WEB_API_BRIDGE_INSTALLED__) return;
  window.__PI_WEB_API_BRIDGE_INSTALLED__ = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const value = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (isBackendApiUrl(value)) {
      return nativeFetch(value.startsWith("/api/") ? apiUrl(value) : input, {
        ...init,
        credentials: init?.credentials ?? "include",
      }).then((response) => {
        if (response.status === 401 && !isPublicAccountUrl(value)) {
          window.dispatchEvent(new Event("pi-web-auth-required"));
        }
        return response;
      });
    }
    return nativeFetch(input, init);
  }) as typeof window.fetch;

  const NativeEventSource = window.EventSource;
  class ApiEventSource extends NativeEventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      const rawValue = typeof url === "string" ? url : url.toString();
      const isApi = isBackendApiUrl(rawValue);
      const value = rawValue.startsWith("/api/") ? apiUrl(rawValue) : url;
      super(value, isApi
        ? { ...eventSourceInitDict, withCredentials: true }
        : eventSourceInitDict);
    }
  }
  window.EventSource = ApiEventSource;
}

export function apiDownloadUrl(encodedPath: string, sessionId?: string | null): string {
  const params = new URLSearchParams({ type: "download" });
  if (sessionId) params.set("sessionId", sessionId);
  return apiUrl(`/api/files/${encodedPath}?${params.toString()}`);
}
