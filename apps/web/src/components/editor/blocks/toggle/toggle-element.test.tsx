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
  it("hides body when open=false", () => {
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
    expect(screen.queryByTestId("toggle-body")).toBeNull();
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
    expect(screen.getByTestId("toggle-body")).toBeInTheDocument();
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
    fireEvent.mouseDown(screen.getByTestId("toggle-chevron"));
    expect(setNodes).toHaveBeenCalledWith(
      { open: true },
      expect.anything(),
    );
  });
});
