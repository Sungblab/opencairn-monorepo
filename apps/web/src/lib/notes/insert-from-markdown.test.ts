import { describe, expect, it, vi, beforeEach } from "vitest";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { insertFromMarkdown } from "./insert-from-markdown";

const insertNodes = vi.fn();
const fakeEditor = {
  tf: { insertNodes },
  children: [{ type: "p", children: [{ text: "" }] }],
} as never;

const onMissingTarget = vi.fn();
const onSuccess = vi.fn();
const onCreatedNote = vi.fn();
const onError = vi.fn();
const apiCreateNote = vi.fn();

beforeEach(() => {
  useActiveEditorStore.setState({ editors: new Map() });
  insertNodes.mockClear();
  onMissingTarget.mockClear();
  onSuccess.mockClear();
  onCreatedNote.mockClear();
  onError.mockClear();
  apiCreateNote.mockClear();
});

describe("insertFromMarkdown", () => {
  it("inserts into the active editor when the target is a plate note", async () => {
    useActiveEditorStore.getState().setEditor("note-1", fakeEditor);

    await insertFromMarkdown({
      markdown: "# Hello",
      activeNoteId: "note-1",
      activeNoteIsPlate: true,
      apiCreateNote,
      onMissingTarget,
      onSuccess,
      onCreatedNote,
      onError,
    });

    expect(insertNodes).toHaveBeenCalledTimes(1);
    expect(insertNodes.mock.calls[0]?.[1]).toEqual({ at: [1] });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onMissingTarget).not.toHaveBeenCalled();
  });

  it("invokes onMissingTarget when activeNoteIsPlate is false", async () => {
    await insertFromMarkdown({
      markdown: "# Hello",
      activeNoteId: "note-1",
      activeNoteIsPlate: false,
      apiCreateNote,
      onMissingTarget,
      onSuccess,
      onCreatedNote,
      onError,
    });

    expect(onMissingTarget).toHaveBeenCalledTimes(1);
    expect(insertNodes).not.toHaveBeenCalled();
    expect(apiCreateNote).not.toHaveBeenCalled();
  });

  it("invokes onMissingTarget when no active note", async () => {
    await insertFromMarkdown({
      markdown: "# Hello",
      activeNoteId: undefined,
      activeNoteIsPlate: false,
      apiCreateNote,
      onMissingTarget,
      onSuccess,
      onCreatedNote,
      onError,
    });

    expect(onMissingTarget).toHaveBeenCalledTimes(1);
  });

  it("invokes onMissingTarget when active note has no registered editor", async () => {
    // active note is plate but the store entry is missing
    await insertFromMarkdown({
      markdown: "# Hello",
      activeNoteId: "note-2",
      activeNoteIsPlate: true,
      apiCreateNote,
      onMissingTarget,
      onSuccess,
      onCreatedNote,
      onError,
    });

    expect(onMissingTarget).toHaveBeenCalledTimes(1);
  });

  it("calls onError when the editor throws", async () => {
    insertNodes.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    useActiveEditorStore.getState().setEditor("note-1", fakeEditor);

    await insertFromMarkdown({
      markdown: "# Hello",
      activeNoteId: "note-1",
      activeNoteIsPlate: true,
      apiCreateNote,
      onMissingTarget,
      onSuccess,
      onCreatedNote,
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("createNoteFromMarkdown", () => {
  it("calls apiCreateNote with title + content", async () => {
    apiCreateNote.mockResolvedValue({ id: "new-note", title: "T" });
    const { createNoteFromMarkdown } = await import("./insert-from-markdown");

    await createNoteFromMarkdown({
      title: "T",
      markdown: "# Body",
      apiCreateNote,
      onCreated: onCreatedNote,
      onError,
    });

    expect(apiCreateNote).toHaveBeenCalledTimes(1);
    expect(onCreatedNote).toHaveBeenCalledWith({ id: "new-note", title: "T" });
  });
});
