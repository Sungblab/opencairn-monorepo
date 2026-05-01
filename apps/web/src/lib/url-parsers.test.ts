import { describe, expect, it } from "vitest";
import { parseWorkspacePath } from "./url-parsers";

describe("parseWorkspacePath", () => {
  it("workspace root", () => {
    expect(parseWorkspacePath("/ko/workspace/acme")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: null,
      noteId: null,
    });
  });

  it("workspace note", () => {
    expect(parseWorkspacePath("/ko/workspace/acme/note/n1")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: null,
      noteId: "n1",
    });
  });

  it("default-locale canonical workspace note", () => {
    expect(parseWorkspacePath("/workspace/acme/note/n1")).toEqual({
      locale: null,
      wsSlug: "acme",
      projectId: null,
      noteId: "n1",
    });
  });

  it("project root", () => {
    expect(parseWorkspacePath("/en/workspace/acme/project/p1")).toEqual({
      locale: "en",
      wsSlug: "acme",
      projectId: "p1",
      noteId: null,
    });
  });

  it("project note", () => {
    expect(parseWorkspacePath("/ko/workspace/acme/project/p1/note/n2")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: "p1",
      noteId: "n2",
    });
  });

  it("default-locale canonical project note", () => {
    expect(parseWorkspacePath("/workspace/acme/project/p1/note/n2")).toEqual({
      locale: null,
      wsSlug: "acme",
      projectId: "p1",
      noteId: "n2",
    });
  });

  it("project sub-route (learn)", () => {
    expect(parseWorkspacePath("/ko/workspace/acme/project/p1/learn/flashcards")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: "p1",
      noteId: null,
    });
  });

  it("non-workspace localized path", () => {
    expect(parseWorkspacePath("/ko/dashboard")).toEqual({
      locale: "ko",
      wsSlug: null,
      projectId: null,
      noteId: null,
    });
  });

  it("non-localized path", () => {
    expect(parseWorkspacePath("/api/health")).toEqual({
      locale: null,
      wsSlug: null,
      projectId: null,
      noteId: null,
    });
  });

  it("trailing slash tolerated", () => {
    expect(parseWorkspacePath("/ko/workspace/acme/")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: null,
      noteId: null,
    });
  });

  it("query/hash stripped", () => {
    expect(parseWorkspacePath("/ko/workspace/acme/project/p1?tab=foo#x")).toEqual({
      locale: "ko",
      wsSlug: "acme",
      projectId: "p1",
      noteId: null,
    });
  });
});
