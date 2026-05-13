import { describe, expect, it } from "vitest";
import { tabToUrl, urlToTabTarget, type TabRoute } from "./tab-url";

describe("tabToUrl", () => {
  const cases: Array<[TabRoute, string]> = [
    [{ kind: "dashboard", targetId: null }, "/ko/workspace/acme/"],
    [{ kind: "note", targetId: "n-123" }, "/ko/workspace/acme/note/n-123"],
    [
      { kind: "note", targetId: "n-123", mode: "source" },
      "/ko/workspace/acme/note/n-123/source",
    ],
    [
      { kind: "note", targetId: "n-123", mode: "reading" },
      "/ko/workspace/acme/note/n-123/reading",
    ],
    [
      { kind: "note", targetId: "n-123", mode: "data" },
      "/ko/workspace/acme/note/n-123/data",
    ],
    [
      { kind: "note", targetId: "n-123", mode: "canvas" },
      "/ko/workspace/acme/note/n-123/canvas",
    ],
    [
      { kind: "agent_file", targetId: "f-1", mode: "agent-file" },
      "/ko/workspace/acme/file/f-1",
    ],
    [
      { kind: "code_workspace", targetId: "cw-1", mode: "code-workspace" },
      "/ko/workspace/acme/code-workspace/cw-1",
    ],
    [{ kind: "project", targetId: "p-1" }, "/ko/workspace/acme/project/p-1"],
    [
      { kind: "project", targetId: "p-1", mode: "graph" },
      "/ko/workspace/acme/project/p-1/graph",
    ],
    [{ kind: "research_hub", targetId: null }, "/ko/workspace/acme/research"],
    [{ kind: "research_run", targetId: "r-1" }, "/ko/workspace/acme/research/r-1"],
    [{ kind: "import", targetId: null }, "/ko/workspace/acme"],
    [{ kind: "help", targetId: null }, "/ko/workspace/acme/help"],
    [{ kind: "report", targetId: null }, "/ko/workspace/acme/report"],
    [{ kind: "ws_settings", targetId: null }, "/ko/workspace/acme/settings"],
    [
      { kind: "ws_settings", targetId: "members" },
      "/ko/workspace/acme/settings/members",
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
    ["/ko/workspace/acme/", { kind: "dashboard", targetId: null }],
    ["/ko/workspace/acme/note/n-9", { kind: "note", targetId: "n-9" }],
    [
      "/ko/workspace/acme/note/n-9/source",
      { kind: "note", targetId: "n-9", mode: "source" },
    ],
    [
      "/ko/workspace/acme/note/n-9/reading",
      { kind: "note", targetId: "n-9", mode: "reading" },
    ],
    [
      "/ko/workspace/acme/note/n-9/data",
      { kind: "note", targetId: "n-9", mode: "data" },
    ],
    [
      "/ko/workspace/acme/note/n-9/canvas",
      { kind: "note", targetId: "n-9", mode: "canvas" },
    ],
    [
      "/ko/workspace/acme/file/f-1",
      { kind: "agent_file", targetId: "f-1", mode: "agent-file" },
    ],
    [
      "/ko/workspace/acme/code-workspace/cw-1",
      { kind: "code_workspace", targetId: "cw-1", mode: "code-workspace" },
    ],
    ["/workspace/acme/note/n-9", { kind: "note", targetId: "n-9" }],
    ["/ko/workspace/acme/project/p-3", { kind: "project", targetId: "p-3" }],
    [
      "/ko/workspace/acme/project/p-3/graph",
      { kind: "project", targetId: "p-3", mode: "graph" },
    ],
    [
      "/ko/workspace/acme/project/p-3/note/n-9",
      { kind: "note", targetId: "n-9" },
    ],
    [
      "/workspace/acme/project/p-3/note/n-9",
      { kind: "note", targetId: "n-9" },
    ],
    ["/ko/workspace/acme/research", { kind: "research_hub", targetId: null }],
    ["/ko/workspace/acme/research/r-77", { kind: "research_run", targetId: "r-77" }],
    ["/ko/workspace/acme/import", { kind: "dashboard", targetId: null }],
    ["/ko/workspace/acme/help", { kind: "help", targetId: null }],
    ["/ko/workspace/acme/report", { kind: "report", targetId: null }],
    ["/ko/workspace/acme/settings", { kind: "ws_settings", targetId: null }],
    [
      "/ko/workspace/acme/settings/members",
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
