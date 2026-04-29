import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  csrfOriginGuard,
  securityHeaders,
  trustedOriginsFromEnv,
} from "../src/lib/security";

function makeApp() {
  const app = new Hono();
  app.use("*", securityHeaders());
  app.use("*", csrfOriginGuard());
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.post("/api/workspaces", (c) => c.json({ ok: true }));
  app.post("/api/internal/test-seed", (c) => c.json({ ok: true }));
  return app;
}

describe("API HTTP security middleware", () => {
  it("uses explicit CORS_ORIGIN before web URL fallbacks", () => {
    expect(
      trustedOriginsFromEnv({
        CORS_ORIGIN: "https://app.example, https://admin.example",
        WEB_URL: "https://wide.example",
      } as NodeJS.ProcessEnv),
    ).toEqual(["https://app.example", "https://admin.example"]);
  });

  it("sets baseline security headers", async () => {
    const res = await makeApp().request("/api/health");

    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
  });

  it("rejects unsafe browser requests from untrusted origins", async () => {
    const res = await makeApp().request("/api/workspaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ name: "csrf" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("allows unsafe requests from configured trusted origins", async () => {
    const res = await makeApp().request("/api/workspaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ name: "trusted" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("does not apply browser CSRF checks to internal-secret routes", async () => {
    const res = await makeApp().request("/api/internal/test-seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
