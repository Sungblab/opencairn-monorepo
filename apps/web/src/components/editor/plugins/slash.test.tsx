import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import editorMessages from "@/../messages/ko/editor.json";
import docEditorMessages from "@/../messages/ko/doc-editor.json";
import { SlashMenu, type SlashEditor } from "./slash";

vi.mock("@platejs/table", () => ({
  insertTable: vi.fn(),
}));

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

    const buttons = screen.getAllByRole("option");
    expect(buttons[0]).toHaveAttribute("data-testid", "slash-cmd-improve");
    expect(buttons[1]).toHaveAttribute("data-testid", "slash-cmd-translate");
  });

  it("groups AI, text, research, structure, and media commands for hybrid notes", () => {
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

    expect(screen.getByTestId("slash-section-ai")).toHaveTextContent("AI");
    expect(screen.getByTestId("slash-section-text")).toHaveTextContent("텍스트");
    expect(screen.getByTestId("slash-section-research")).toHaveTextContent(
      "연구",
    );
    expect(screen.getByTestId("slash-section-structure")).toHaveTextContent(
      "구조",
    );
    expect(screen.getByTestId("slash-section-media")).toHaveTextContent(
      "미디어",
    );
    expect(screen.getByTestId("slash-cmd-make_note")).toBeInTheDocument();
    expect(screen.getByTestId("slash-cmd-equation")).toBeInTheDocument();
  });

  it("dispatches source-backed agent commands from the slash menu", () => {
    const editor = makeEditor();
    const onAgentCommand = vi.fn();

    render(
      wrap(
        <>
          <div data-slate-editor="true" tabIndex={-1} data-testid="editor" />
          <SlashMenu
            editor={editor}
            aiEnabled
            onAgentCommand={onAgentCommand}
          />
        </>,
      ),
    );

    const editorEl = screen.getByTestId("editor") as HTMLDivElement;
    editorEl.focus();
    pressSlashAndFlush();

    fireEvent.mouseDown(screen.getByTestId("slash-cmd-make_note"));

    expect(onAgentCommand).toHaveBeenCalledWith("make_note");
    expect(editor.tf.deleteBackward).toHaveBeenCalledTimes(1);
  });

  it("inserts a real code block from the slash command", () => {
    const editor = makeEditor();

    render(
      wrap(
        <>
          <div data-slate-editor="true" tabIndex={-1} data-testid="editor" />
          <SlashMenu editor={editor} />
        </>,
      ),
    );

    const editorEl = screen.getByTestId("editor") as HTMLDivElement;
    editorEl.focus();
    pressSlashAndFlush();

    fireEvent.mouseDown(screen.getByTestId("slash-cmd-code"));

    expect(editor.tf.insertNodes).toHaveBeenCalledWith(
      {
        type: "code_block",
        language: "plaintext",
        children: [{ type: "code_line", children: [{ text: "" }] }],
      },
      { select: true },
    );
    expect(editor.tf.insertNodes).toHaveBeenCalledWith(
      { type: "p", children: [{ text: "" }] },
      { select: true },
    );
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

  it("filters commands from the query typed after '/' and removes the trigger text", () => {
    const editor = makeEditor();
    render(
      wrap(
        <>
          <div data-slate-editor="true" tabIndex={-1} data-testid="editor" />
          <SlashMenu editor={editor} />
        </>,
      ),
    );

    const editorEl = screen.getByTestId("editor") as HTMLDivElement;
    editorEl.focus();
    pressSlashAndFlush();

    fireEvent.keyDown(window, { key: "t" });
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "b" });

    expect(screen.getByTestId("slash-query")).toHaveTextContent("/tab");
    expect(screen.getByTestId("slash-cmd-table")).toBeInTheDocument();
    expect(screen.queryByTestId("slash-cmd-h1")).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("slash-cmd-table"));

    expect(editor.tf.deleteBackward).toHaveBeenCalledTimes(4);
  });

  it("tracks slashes typed while searching and deletes the full raw query", () => {
    const editor = makeEditor();
    render(
      wrap(
        <>
          <div data-slate-editor="true" tabIndex={-1} data-testid="editor" />
          <SlashMenu editor={editor} />
        </>,
      ),
    );

    const editorEl = screen.getByTestId("editor") as HTMLDivElement;
    editorEl.focus();
    pressSlashAndFlush();

    fireEvent.keyDown(window, { key: "t" });
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.keyDown(window, { key: "/" });

    expect(screen.getByTestId("slash-query")).toHaveTextContent("/tab/");
    expect(screen.getByTestId("slash-cmd-table")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("slash-cmd-table"));

    expect(editor.tf.deleteBackward).toHaveBeenCalledTimes(5);
  });

  it("counts non-BMP query characters as one deleted editor character", () => {
    const editor = makeEditor();
    render(
      wrap(
        <>
          <div data-slate-editor="true" tabIndex={-1} data-testid="editor" />
          <SlashMenu editor={editor} />
        </>,
      ),
    );

    const editorEl = screen.getByTestId("editor") as HTMLDivElement;
    editorEl.focus();
    pressSlashAndFlush();

    fireEvent.keyDown(window, { key: "t" });
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.keyDown(window, { key: "😀" });

    expect(screen.getByTestId("slash-query")).toHaveTextContent("/tab😀");
    expect(screen.getByTestId("slash-cmd-table")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("slash-cmd-table"));

    expect(editor.tf.deleteBackward).toHaveBeenCalledTimes(5);
  });

  it("removes the last non-BMP query character as one character on Backspace", () => {
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

    fireEvent.keyDown(window, { key: "t" });
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.keyDown(window, { key: "😀" });
    fireEvent.keyDown(window, { key: "Backspace" });

    expect(screen.getByTestId("slash-query")).toHaveTextContent("/tab");
    expect(screen.getByTestId("slash-cmd-table")).toBeInTheDocument();
  });

  it("filters commands from IME composition text", () => {
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

    fireEvent.compositionEnd(window, { data: "표" });

    expect(screen.getByTestId("slash-query")).toHaveTextContent("/표");
    expect(screen.getByTestId("slash-cmd-table")).toBeInTheDocument();
    expect(screen.queryByTestId("slash-cmd-h1")).not.toBeInTheDocument();
  });

  it("supports keyboard selection without leaving the editor surface", () => {
    const editor = makeEditor();
    const onAiCommand = vi.fn();
    render(
      wrap(
        <>
          <div data-slate-editor="true" tabIndex={-1} data-testid="editor" />
          <SlashMenu editor={editor} aiEnabled onAiCommand={onAiCommand} />
        </>,
      ),
    );

    const editorEl = screen.getByTestId("editor") as HTMLDivElement;
    editorEl.focus();
    pressSlashAndFlush();

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(onAiCommand).toHaveBeenCalledWith("translate");
    expect(editor.tf.deleteBackward).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(editorEl);
  });
});
