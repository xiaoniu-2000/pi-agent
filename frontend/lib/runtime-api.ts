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
    if (typeof input === "string") return nativeFetch(apiUrl(input), init);
    if (input instanceof URL) return nativeFetch(apiUrl(input.toString()), init);
    return nativeFetch(input, init);
  }) as typeof window.fetch;

  const NativeEventSource = window.EventSource;
  class ApiEventSource extends NativeEventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      const value = typeof url === "string" ? apiUrl(url) : url;
      super(value, eventSourceInitDict);
    }
  }
  window.EventSource = ApiEventSource;
}

export function apiDownloadUrl(encodedPath: string, sessionId?: string | null): string {
  const params = new URLSearchParams({ type: "download" });
  if (sessionId) params.set("sessionId", sessionId);
  return apiUrl(`/api/files/${encodedPath}?${params.toString()}`);
}
