import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import editorMessages from "@/../messages/ko/editor.json";
import docEditorMessages from "@/../messages/ko/doc-editor.json";
import { SlashMenu, type SlashEditor } from "./slash";

// S1-001 — SlashMenu's window-scoped keydown listener must NOT open the menu
// when the focused element is outside the Plate editor (e.g. the note title
// input or a comment composer). If it did, clicking a command would call
// `editor.tf.deleteBackward("character")` against the editor and silently
// destroy unrelated content.

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider
    locale="ko"
    messages={{ editor: editorMessages, docEditor: docEditorMessages }}
  >
    {ui}
  </NextIntlClientProvider>
);

function makeEditor(): SlashEditor {
  return {
    tf: {
      insertNodes: vi.fn(),
      deleteBackward: vi.fn(),
    },
  };
}

describe("SlashMenu focus gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function pressSlashAndFlush() {
    act(() => {
      fireEvent.keyDown(window, { key: "/" });
    });
    // The handler defers `setOpen(true)` via setTimeout(0) so Plate can
    // process the `/` insertion first. Flush that timer.
    act(() => {
      vi.advanceTimersByTime(1);
    });
  }

  it("does not open when '/' is typed in an input outside the editor", () => {
    render(
      wrap(
        <>
          <input data-testid="title" />
          <div data-slate-editor="true" tabIndex={-1} data-testid="editor" />
          <SlashMenu editor={makeEditor()} />
        </>,
      ),
    );

    const title = screen.getByTestId("title") as HTMLInputElement;
    title.focus();
    expect(document.activeElement).toBe(title);

    pressSlashAndFlush();

    expect(screen.queryByTestId("slash-menu")).not.toBeInTheDocument();
  });

  it("does not open when '/' is typed in a textarea outside the editor", () => {
    render(
      wrap(
        <>
          <textarea data-testid="comment" />
          <div data-slate-editor="true" tabIndex={-1} data-testid="editor" />
          <SlashMenu editor={makeEditor()} />
        </>,
      ),
    );

    const comment = screen.getByTestId("comment") as HTMLTextAreaElement;
    comment.focus();

    pressSlashAndFlush();

    expect(screen.queryByTestId("slash-menu")).not.toBeInTheDocument();
  });

  it("opens when '/' is typed inside the Plate editor surface", () => {
    render(
      wrap(
        <>
          <input data-testid="title" />
          <div data-slate-editor="true" tabIndex={-1} data-testid="editor" />
          <SlashMenu editor={makeEditor()} />
        </>,
      ),
    );

    const editorEl = screen.getByTestId("editor") as HTMLDivElement;
    editorEl.focus();
    expect(document.activeElement).toBe(editorEl);

    pressSlashAndFlush();

    expect(screen.queryByTestId("slash-menu")).toBeInTheDocument();
  });

  it("opens when '/' is typed in a descendant of the Plate editor surface", () => {
    render(
      wrap(
        <>
          <div data-slate-editor="true" data-testid="editor">
            <span data-testid="leaf" tabIndex={-1} />
          </div>
          <SlashMenu editor={makeEditor()} />
        </>,
      ),
    );

    const leaf = screen.getByTestId("leaf") as HTMLSpanElement;
    leaf.focus();

    pressSlashAndFlush();

    expect(screen.queryByTestId("slash-menu")).toBeInTheDocument();
  });

  it("puts AI commands before block commands when AI is enabled", () => {
    render(
      wrap(
        <>
          <div data-slate-editor="true" tabIndex={-1} data-testid="editor" />
          <SlashMenu editor={makeEditor()} aiEnabled />
        </>,
      ),
    );

    const editorEl = screen.getByTestId("editor") as HTMLDivElement;
    editorEl.focus();
    pressSlashAndFlush();

    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveAttribute("data-testid", "slash-cmd-improve");
    expect(buttons[1]).toHaveAttribute("data-testid", "slash-cmd-translate");
  });

  it("opens as a lightweight command menu without dimming the whole page", () => {
    render(
      wrap(
        <>
          <div data-slate-editor="true" tabIndex={-1} data-testid="editor" />
          <SlashMenu editor={makeEditor()} />
        </>,
      ),
    );

    const editorEl = screen.getByTestId("editor") as HTMLDivElement;
    editorEl.focus();
    pressSlashAndFlush();

    expect(screen.getByTestId("slash-menu").className).not.toContain(
      "bg-black/20",
    );
  });
});
