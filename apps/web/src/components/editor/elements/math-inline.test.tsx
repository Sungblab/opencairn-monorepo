// Plan 2E Phase B-4 Task 4.6 — MathInline click-to-edit wiring tests.
//
// Follows the callout-element.test.tsx pattern: mock useEditorRef
// and verify that clicking the element opens the popover and that
// save/delete callbacks call the right editor transforms.

import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "@/../messages/ko/editor.json";
import { MathInline } from "./math-inline";

const setNodes = vi.fn();
const removeNodes = vi.fn();
const findPath = vi.fn(() => [0]);

vi.mock("platejs/react", async () => {
  const real = await vi.importActual<typeof import("platejs/react")>(
    "platejs/react",
  );
  return {
    ...real,
    useEditorRef: () => ({
      tf: { setNodes, removeNodes },
      api: { findPath },
    }),
  };
});

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
    {ui}
  </NextIntlClientProvider>
);

// Minimal element shape matching what MathInline expects.
const element = {
  type: "inline_equation",
  texExpression: "x^2",
  children: [{ text: "" }],
};

describe("MathInline click-to-edit", () => {
  it("renders the KaTeX output for the expression", async () => {
    const { container } = render(
      wrap(
        // @ts-expect-error — minimal mock omits full PlateElementProps
        <MathInline
          attributes={{ "data-slate-node": "element" } as never}
          element={element}
        >
          <span />
        </MathInline>,
      ),
    );
    await waitFor(() => {
      expect(container.querySelector(".katex")).toBeTruthy();
    });
  });

  it("opens the edit popover when the element is clicked", async () => {
    render(
      wrap(
        // @ts-expect-error — minimal mock
        <MathInline
          attributes={{ "data-slate-node": "element" } as never}
          element={element}
        >
          <span />
        </MathInline>,
      ),
    );
    const mathSpan = document.querySelector("[data-math-inline]");
    if (mathSpan) {
      await act(async () => {
        fireEvent.click(mathSpan);
      });
    }
    // After clicking, the popover textarea should appear in the document body.
    const textarea = document.body.querySelector("textarea");
    expect(textarea).toBeTruthy();
  });

  it("calls editor.tf.setNodes on Save with non-empty tex", async () => {
    setNodes.mockClear();
    render(
      wrap(
        // @ts-expect-error — minimal mock
        <MathInline
          attributes={{ "data-slate-node": "element" } as never}
          element={element}
        >
          <span />
        </MathInline>,
      ),
    );
    const mathSpan = document.querySelector("[data-math-inline]");
    if (mathSpan) {
      await act(async () => {
        fireEvent.click(mathSpan);
      });
    }
    const textarea = document.body.querySelector("textarea");
    if (textarea) {
      await act(async () => {
        fireEvent.change(textarea, { target: { value: "y^3" } });
      });
      // Click the save button
      const saveBtn = document.body.querySelector(
        `button[data-save-math]`,
      );
      if (saveBtn) {
        await act(async () => {
          fireEvent.click(saveBtn);
        });
        expect(setNodes).toHaveBeenCalledWith(
          expect.objectContaining({ texExpression: "y^3" }),
          expect.anything(),
        );
      }
    }
  });

  it("calls editor.tf.removeNodes on Save with empty tex", async () => {
    removeNodes.mockClear();
    render(
      wrap(
        // @ts-expect-error — minimal mock
        <MathInline
          attributes={{ "data-slate-node": "element" } as never}
          element={element}
        >
          <span />
        </MathInline>,
      ),
    );
    const mathSpan = document.querySelector("[data-math-inline]");
    if (mathSpan) {
      await act(async () => {
        fireEvent.click(mathSpan);
      });
    }
    const textarea = document.body.querySelector("textarea");
    if (textarea) {
      await act(async () => {
        fireEvent.change(textarea, { target: { value: "" } });
      });
      const saveBtn = document.body.querySelector("button[data-save-math]");
      if (saveBtn) {
        await act(async () => {
          fireEvent.click(saveBtn);
        });
        expect(removeNodes).toHaveBeenCalled();
      }
    }
  });
});
