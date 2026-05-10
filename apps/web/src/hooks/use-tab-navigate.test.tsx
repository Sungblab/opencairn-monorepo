import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabNavigate } from "./use-tab-navigate";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => ({ locale: "ko", wsSlug: "acme" }),
}));

describe("useTabNavigate", () => {
  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
  });

  it("pushes a tab route by default", () => {
    const { result } = renderHook(() => useTabNavigate());

    act(() => {
      result.current({ kind: "note", targetId: "n-5" });
    });

    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/note/n-5");
    expect(replace).not.toHaveBeenCalled();
  });

  it("replaces the current URL when requested", () => {
    const { result } = renderHook(() => useTabNavigate());

    act(() => {
      result.current(
        { kind: "dashboard", targetId: null },
        { mode: "replace" },
      );
    });

    expect(replace).toHaveBeenCalledWith("/ko/workspace/acme/");
    expect(push).not.toHaveBeenCalled();
  });
});
