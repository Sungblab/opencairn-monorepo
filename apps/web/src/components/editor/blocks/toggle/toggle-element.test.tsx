import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToggleElement } from "./toggle-element";

const setNodes = vi.fn();
vi.mock("platejs/react", async () => {
  const real = await vi.importActual<typeof import("platejs/react")>(
    "platejs/react",
  );
  return {
    ...real,
    useEditorRef: () => ({
      tf: { setNodes },
      api: { findPath: () => [0] },
    }),
  };
});

describe("ToggleElement", () => {
  // Slate requires children to remain in the DOM regardless of UI state, so
  // both `open=false` and `open=true` keep the body mounted; only the
  // visibility/data-open marker differs.
  it("CSS-hides body when open=false but keeps it in the DOM", () => {
    render(
      // @ts-expect-error — test mock omits Plate's full editor context
      <ToggleElement
        attributes={{ "data-slate-node": "element" } as never}
        element={{
          type: "toggle",
          open: false,
          children: [
            { type: "p", children: [{ text: "summary" }] },
            { type: "p", children: [{ text: "body" }] },
          ],
        }}
      >
        <p>summary</p>
        <p>body</p>
      </ToggleElement>,
    );
    const body = screen.getByTestId("toggle-body");
    expect(body).toBeInTheDocument();
    expect(body).toHaveAttribute("data-open", "false");
    expect(body).toHaveStyle({ display: "none" });
  });

  it("shows body when open=true", () => {
    render(
      // @ts-expect-error — test mock omits Plate's full editor context
      <ToggleElement
        attributes={{ "data-slate-node": "element" } as never}
        element={{
          type: "toggle",
          open: true,
          children: [
            { type: "p", children: [{ text: "summary" }] },
            { type: "p", children: [{ text: "body" }] },
          ],
        }}
      >
        <p>summary</p>
        <p>body</p>
      </ToggleElement>,
    );
    const body = screen.getByTestId("toggle-body");
    expect(body).toBeInTheDocument();
    expect(body).toHaveAttribute("data-open", "true");
    expect(body).not.toHaveStyle({ display: "none" });
  });

  it("toggles on chevron click", () => {
    setNodes.mockClear();
    render(
      // @ts-expect-error — test mock omits Plate's full editor context
      <ToggleElement
        attributes={{ "data-slate-node": "element" } as never}
        element={{
          type: "toggle",
          open: false,
          children: [{ type: "p", children: [{ text: "x" }] }],
        }}
      >
        <p>x</p>
      </ToggleElement>,
    );
    fireEvent.pointerDown(screen.getByTestId("toggle-chevron"));
    expect(setNodes).toHaveBeenCalledWith(
      { open: true },
      expect.anything(),
    );
  });
});
