import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "@/../messages/ko/editor.json";
import { CalloutElement } from "./callout-element";

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

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
    {ui}
  </NextIntlClientProvider>
);

describe("CalloutElement", () => {
  it("renders kind=info icon by default", () => {
    render(
      wrap(
        // @ts-expect-error — test mock omits Plate's full editor context
        <CalloutElement
          attributes={{ "data-slate-node": "element" } as never}
          element={{
            type: "callout",
            kind: "info",
            children: [{ type: "p", children: [{ text: "x" }] }],
          }}
        >
          <p>x</p>
        </CalloutElement>,
      ),
    );
    expect(screen.getByTestId("callout-kind-button")).toHaveAttribute(
      "data-kind",
      "info",
    );
  });

  it("cycles to next kind on icon click (info → warn)", () => {
    setNodes.mockClear();
    render(
      wrap(
        // @ts-expect-error — test mock omits Plate's full editor context
        <CalloutElement
          attributes={{ "data-slate-node": "element" } as never}
          element={{
            type: "callout",
            kind: "info",
            children: [{ type: "p", children: [{ text: "x" }] }],
          }}
        >
          <p>x</p>
        </CalloutElement>,
      ),
    );
    fireEvent.mouseDown(screen.getByTestId("callout-kind-button"));
    expect(setNodes).toHaveBeenCalledWith(
      { kind: "warn" },
      expect.objectContaining({ at: [0] }),
    );
  });

  it("cycles danger → info (wraps)", () => {
    setNodes.mockClear();
    render(
      wrap(
        // @ts-expect-error — test mock omits Plate's full editor context
        <CalloutElement
          attributes={{ "data-slate-node": "element" } as never}
          element={{
            type: "callout",
            kind: "danger",
            children: [{ type: "p", children: [{ text: "x" }] }],
          }}
        >
          <p>x</p>
        </CalloutElement>,
      ),
    );
    fireEvent.mouseDown(screen.getByTestId("callout-kind-button"));
    expect(setNodes).toHaveBeenCalledWith(
      { kind: "info" },
      expect.anything(),
    );
  });
});
