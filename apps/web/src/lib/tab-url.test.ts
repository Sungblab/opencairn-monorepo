import { describe, expect, it } from "vitest";
import { tabToUrl, urlToTabTarget, type TabRoute } from "./tab-url";

describe("tabToUrl", () => {
  const cases: Array<[TabRoute, string]> = [
    [{ kind: "dashboard", targetId: null }, "/w/acme/"],
    [{ kind: "note", targetId: "n-123" }, "/w/acme/n/n-123"],
    [{ kind: "project", targetId: "p-1" }, "/w/acme/p/p-1"],
    [{ kind: "research_hub", targetId: null }, "/w/acme/research"],
    [{ kind: "research_run", targetId: "r-1" }, "/w/acme/research/r-1"],
    [{ kind: "import", targetId: null }, "/w/acme/import"],
    [{ kind: "ws_settings", targetId: null }, "/w/acme/settings"],
    [
      { kind: "ws_settings", targetId: "members" },
      "/w/acme/settings/members",
    ],
  ];
  for (const [route, url] of cases) {
    it(`maps ${route.kind}/${route.targetId} -> ${url}`, () => {
      expect(tabToUrl("acme", route)).toBe(url);
    });
  }
});

describe("urlToTabTarget", () => {
  const cases: Array<[string, TabRoute | null]> = [
    ["/w/acme/", { kind: "dashboard", targetId: null }],
    ["/w/acme/n/n-9", { kind: "note", targetId: "n-9" }],
    ["/w/acme/p/p-3", { kind: "project", targetId: "p-3" }],
    ["/w/acme/research", { kind: "research_hub", targetId: null }],
    ["/w/acme/research/r-77", { kind: "research_run", targetId: "r-77" }],
    ["/w/acme/import", { kind: "import", targetId: null }],
    ["/w/acme/settings", { kind: "ws_settings", targetId: null }],
    [
      "/w/acme/settings/members",
      { kind: "ws_settings", targetId: "members" },
    ],
    ["/some/other/path", null],
    ["/settings/profile", null],
  ];
  for (const [url, expected] of cases) {
    it(`parses ${url}`, () => {
      const r = urlToTabTarget(url);
      if (expected === null) {
        expect(r).toBeNull();
      } else {
        expect(r).toEqual({ slug: "acme", route: expected });
      }
    });
  }
});
