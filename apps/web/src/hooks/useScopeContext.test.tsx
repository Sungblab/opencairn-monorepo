import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

// next/navigation is per-render so we override it via vi.mock and let
// each test mutate the references. This avoids needing a separate
// renderHook wrapper for each scope variant.
const navState: { params: Record<string, string>; pathname: string } = {
  params: {},
  pathname: "/",
};
vi.mock("next/navigation", () => ({
  useParams: () => navState.params,
  usePathname: () => navState.pathname,
}));

// Stub the slug→id lookup so this hook test stays isolated from the
// workspace-id query. Returning a stable id keeps assertions simple.
vi.mock("./useWorkspaceId", () => ({
  useWorkspaceId: (slug: string | undefined) =>
    slug ? `ws-id-of-${slug}` : null,
}));

import { useScopeContext } from "./useScopeContext";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

beforeEach(() => {
  navState.params = {};
  navState.pathname = "/";
});

describe("useScopeContext", () => {
  it("returns page scope when noteId is present", () => {
    navState.params = {
      wsSlug: "acme",
      projectId: "proj_1",
      noteId: "note_123",
    };
    navState.pathname = "/ko/workspace/acme/note/note_123";

    const { result } = renderHook(() => useScopeContext(), { wrapper });
    expect(result.current.scopeType).toBe("page");
    expect(result.current.scopeId).toBe("note_123");
    expect(result.current.workspaceSlug).toBe("acme");
    expect(result.current.workspaceId).toBe("ws-id-of-acme");
    expect(result.current.initialChips).toEqual([
      { type: "page", id: "note_123", manual: false },
    ]);
  });

  it("returns project scope when only projectId is present", () => {
    navState.params = { wsSlug: "acme", projectId: "proj_1" };
    navState.pathname = "/ko/workspace/acme/project/proj_1";

    const { result } = renderHook(() => useScopeContext(), { wrapper });
    expect(result.current.scopeType).toBe("project");
    expect(result.current.scopeId).toBe("proj_1");
    expect(result.current.initialChips[0]).toMatchObject({
      type: "project",
      id: "proj_1",
      manual: false,
    });
  });

  it("returns workspace scope when neither projectId nor noteId is present", () => {
    navState.params = { wsSlug: "acme" };
    navState.pathname = "/ko/workspace/acme/chat";

    const { result } = renderHook(() => useScopeContext(), { wrapper });
    expect(result.current.scopeType).toBe("workspace");
    // Once useWorkspaceId resolves, scopeId switches to the resolved id.
    expect(result.current.scopeId).toBe("ws-id-of-acme");
    expect(result.current.initialChips[0].type).toBe("workspace");
  });

  it("falls back to wsSlug as scopeId when workspaceId hasn't resolved yet", async () => {
    navState.params = { wsSlug: "loading" };
    navState.pathname = "/ko/workspace/loading";

    // Override the mock once to simulate the pre-resolve state. The
    // module mock at the top returns `ws-id-of-<slug>` for non-empty
    // slugs; we intercept that one call to return null instead.
    const mod = await import("./useWorkspaceId");
    const spy = vi.spyOn(mod, "useWorkspaceId").mockReturnValueOnce(null);

    const { result } = renderHook(() => useScopeContext(), { wrapper });
    expect(result.current.scopeId).toBe("loading");
    spy.mockRestore();
  });
});
