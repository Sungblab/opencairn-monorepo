import { describe, expect, it } from "vitest";

import { buildCspHeader } from "./csp";

describe("buildCspHeader", () => {
  it("allows the configured Hocuspocus websocket endpoint", () => {
    const header = buildCspHeader({
      hocuspocusUrl: "ws://localhost:1234",
    });

    expect(header).toContain("connect-src");
    expect(header).toContain("ws://localhost:1234");
  });

  it("keeps the websocket origin when the URL contains a path", () => {
    const header = buildCspHeader({
      hocuspocusUrl: "wss://collab.opencairn.example/ws",
    });

    expect(header).toContain("wss://collab.opencairn.example");
    expect(header).not.toContain("wss://collab.opencairn.example/ws");
  });

  it("allows Cloudflare Web Analytics beacon loading and reporting", () => {
    const header = buildCspHeader();

    expect(header).toContain("script-src");
    expect(header).toContain("https://static.cloudflareinsights.com");
    expect(header).toContain("connect-src");
    expect(header).toContain("https://cloudflareinsights.com");
  });

  it("allows Google Identity Services One Tap surfaces", () => {
    const header = buildCspHeader();

    expect(header).toMatch(/script-src[^;]*https:\/\/accounts\.google\.com/);
    expect(header).toMatch(/frame-src[^;]*https:\/\/accounts\.google\.com/);
    expect(header).toMatch(/connect-src[^;]*https:\/\/accounts\.google\.com/);
  });
});
