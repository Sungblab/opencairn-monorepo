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
});
