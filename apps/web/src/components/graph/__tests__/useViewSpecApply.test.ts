// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useViewSpecApply } from "../useViewSpecApply";
import { useViewStateStore } from "../view-state-store";
import type { ViewSpec } from "@opencairn/shared";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

const baseSpec: ViewSpec = {
  viewType: "mindmap",
  layout: "dagre",
  rootId: "11111111-1111-4111-8111-111111111111",
  nodes: [{ id: "11111111-1111-4111-8111-111111111111", name: "n" }],
  edges: [],
  rationale: "test",
};

describe("useViewSpecApply", () => {
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replace = vi.fn();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      replace,
    });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("relation=uses"),
    );
    useViewStateStore.setState({ inline: {} });
  });

  it("stores spec in view-state-store keyed by projectId+viewType+rootId", () => {
    const { result } = renderHook(() => useViewSpecApply());
    act(() => result.current(baseSpec, "proj-1"));
    const got = useViewStateStore
      .getState()
      .getInline("proj-1", "mindmap", baseSpec.rootId);
    expect(got).toEqual(baseSpec);
  });

  it("navigates with view + root and preserves other params", () => {
    const { result } = renderHook(() => useViewSpecApply());
    act(() => result.current(baseSpec, "proj-1"));
    expect(replace).toHaveBeenCalledTimes(1);
    const url = replace.mock.calls[0][0] as string;
    expect(url).toContain("view=mindmap");
    expect(url).toContain(`root=${baseSpec.rootId}`);
    expect(url).toContain("relation=uses");
  });

  it("drops root when spec.rootId is null", () => {
    const { result } = renderHook(() => useViewSpecApply());
    act(() =>
      result.current(
        { ...baseSpec, viewType: "cards", rootId: null },
        "proj-1",
      ),
    );
    const url = replace.mock.calls[0][0] as string;
    expect(url).toContain("view=cards");
    expect(url).not.toContain("root=");
  });

  it("overwrites a stale root from the previous URL", () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("view=graph&root=stale-root&relation=uses"),
    );
    const { result } = renderHook(() => useViewSpecApply());
    act(() => result.current(baseSpec, "proj-1"));
    const url = replace.mock.calls[0][0] as string;
    expect(url).toContain(`root=${baseSpec.rootId}`);
    expect(url).not.toContain("root=stale-root");
  });

  it("drops a stale root when applying a rootless spec", () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("view=mindmap&root=stale-root"),
    );
    const { result } = renderHook(() => useViewSpecApply());
    act(() =>
      result.current(
        { ...baseSpec, viewType: "graph", rootId: null },
        "proj-1",
      ),
    );
    const url = replace.mock.calls[0][0] as string;
    expect(url).not.toContain("root=");
    expect(url).toContain("view=graph");
  });
});
