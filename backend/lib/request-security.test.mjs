import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./request-security.ts");
}

test("allows same-origin and non-browser API requests", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  assert.equal(isApiRequestOriginAllowed(new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: { origin: "http://localhost:30141", "sec-fetch-site": "same-origin" },
  })), true);
  assert.equal(isApiRequestOriginAllowed(new Request("http://localhost:30141/api/test", { method: "POST" })), true);
});

test("allows LAN same-origin requests when Next.js uses an internal localhost URL", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  const request = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30141",
      origin: "http://192.168.32.7:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestOriginAllowed(request), true);
});

test("rejects cross-origin browser API requests", async () => {
  const { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } = await loadSubject();
  const post = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  });
  const crossSiteGet = new Request("http://localhost:30141/api/sessions", {
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(shouldCheckApiRequestOrigin(post), true);
  assert.equal(isApiRequestOriginAllowed(post), false);
  assert.equal(shouldCheckApiRequestOrigin(crossSiteGet), true);
  assert.equal(isApiRequestOriginAllowed(crossSiteGet), false);
});

test("rejects an origin that does not match the external request host", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  const request = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30141",
      origin: "http://attacker.example",
      "sec-fetch-site": "same-site",
    },
  });
  assert.equal(isApiRequestOriginAllowed(request), false);
});

test("allows only explicitly configured frontend origins", async (t) => {
  const previous = process.env.PI_WEB_CORS_ORIGINS;
  process.env.PI_WEB_CORS_ORIGINS = "http://10.10.10.21:8080,http://localhost:8080";
  t.after(() => {
    if (previous === undefined) delete process.env.PI_WEB_CORS_ORIGINS;
    else process.env.PI_WEB_CORS_ORIGINS = previous;
  });

  const { getCorsAllowOrigin, isApiRequestOriginAllowed } = await loadSubject();
  const allowed = new Request("http://backend:30142/api/sessions", {
    headers: { origin: "http://10.10.10.21:8080", "sec-fetch-site": "cross-site" },
  });
  const rejected = new Request("http://backend:30142/api/sessions", {
    headers: { origin: "http://10.10.10.99:8080", "sec-fetch-site": "cross-site" },
  });
  assert.equal(isApiRequestOriginAllowed(allowed), true);
  assert.equal(getCorsAllowOrigin(allowed), "http://10.10.10.21:8080");
  assert.equal(isApiRequestOriginAllowed(rejected), false);
});
