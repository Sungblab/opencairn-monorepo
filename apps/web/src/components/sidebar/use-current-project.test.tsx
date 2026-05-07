import { renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCurrentProjectContext } from "./use-current-project";

const routeParams = vi.hoisted(() => ({
  value: { wsSlug: "acme" as string | undefined },
  pathname: { current: "/ko/workspace/acme" },
}));

vi.mock("next/navigation", () => ({
  useParams: () => routeParams.value,
  usePathname: () => routeParams.pathname.current,
}));

describe("useCurrentProjectContext", () => {
  beforeEach(() => {
    window.localStorage.clear();
    routeParams.value = { wsSlug: "acme" };
    routeParams.pathname.current = "/ko/workspace/acme";
  });

  it("remembers the last selected project per workspace", async () => {
    routeParams.pathname.current = "/ko/workspace/acme/project/p-1";
    const { result, rerender } = renderHook(() => useCurrentProjectContext());

    await waitFor(() => {
      expect(window.localStorage.getItem("opencairn:last-project:acme")).toBe(
        "p-1",
      );
    });
    expect(result.current.projectId).toBe("p-1");
    expect(result.current.routeProjectId).toBe("p-1");

    routeParams.pathname.current = "/ko/workspace/acme";
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

  it("does not read localStorage during server render", () => {
    window.localStorage.setItem("opencairn:last-project:acme", "p-1");

    function Probe() {
      const { projectId } = useCurrentProjectContext();
      return <span>{projectId ?? "none"}</span>;
    }

    expect(renderToString(<Probe />)).toBe("<span>none</span>");
  });
});
