import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCurrentProjectContext } from "./use-current-project";

const routeParams = vi.hoisted(() => ({
  value: { wsSlug: "acme" as string | undefined, projectId: undefined as string | undefined },
}));

vi.mock("next/navigation", () => ({
  useParams: () => routeParams.value,
}));

describe("useCurrentProjectContext", () => {
  beforeEach(() => {
    window.localStorage.clear();
    routeParams.value = { wsSlug: "acme", projectId: undefined };
  });

  it("remembers the last selected project per workspace", async () => {
    routeParams.value = { wsSlug: "acme", projectId: "p-1" };
    const { result, rerender } = renderHook(() => useCurrentProjectContext());

    await waitFor(() => {
      expect(window.localStorage.getItem("opencairn:last-project:acme")).toBe(
        "p-1",
      );
    });
    expect(result.current.projectId).toBe("p-1");
    expect(result.current.routeProjectId).toBe("p-1");

    routeParams.value = { wsSlug: "acme", projectId: undefined };
    rerender();

    await waitFor(() => {
      expect(result.current.projectId).toBe("p-1");
    });
    expect(result.current.routeProjectId).toBeNull();
  });

  it("does not leak selection across workspaces", () => {
    window.localStorage.setItem("opencairn:last-project:other", "p-other");

    const { result } = renderHook(() => useCurrentProjectContext());

    expect(result.current.wsSlug).toBe("acme");
    expect(result.current.projectId).toBeNull();
  });
});
