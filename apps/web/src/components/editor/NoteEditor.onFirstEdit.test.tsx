import { fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Shallow-mock the heavy deps so the test can run headlessly — we only
// care that the wrapper div's paste/drop handlers fire the callback.
// Mocks MUST be declared before the rig import because the rig imports
// NoteEditor, which imports these modules. vi.mock is hoisted by Vitest.
vi.mock("@/hooks/useCollaborativeEditor", () => ({
  useCollaborativeEditor: () => ({
    tf: {},
    children: [{ type: "p", children: [{ text: "" }] }],
  }),
  colorFor: () => "#000",
}));

vi.mock("platejs/react", () => ({
  Plate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PlateContent: (props: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props} />
  ),
}));

// CommentsPanel, PresenceStack, banners, toolbar, wiki-link combobox, and
// slash menu pull network/Yjs deps we don't need here. Stub them.
vi.mock("../collab/DisconnectedBanner", () => ({
  DisconnectedBanner: () => null,
}));
vi.mock("../collab/ReadOnlyBanner", () => ({
  ReadOnlyBanner: () => null,
}));
vi.mock("../comments/CommentsPanel", () => ({
  CommentsPanel: () => null,
}));
vi.mock("./PresenceStack", () => ({
  PresenceStack: () => null,
}));
vi.mock("./editor-toolbar", () => ({
  EditorToolbar: () => null,
}));
vi.mock("./plugins/wiki-link", () => ({
  createWikiLinkPlugin: () => ({}),
  WikiLinkCombobox: () => null,
}));
vi.mock("./plugins/slash", () => ({
  SlashMenu: () => null,
}));

// `./plugins/latex` imports katex.min.css at module scope, which Vitest's
// jsdom transform can't handle without a PostCSS/CSS loader. Stub it to
// an empty plugin array — this test doesn't care about math nodes.
vi.mock("./plugins/latex", () => ({
  latexPlugins: [],
}));

// research-meta-plugin calls `createPlatePlugin` at module scope. The
// `platejs/react` mock above intentionally only exports the surface this
// suite needs, so stub the plugin to an empty object — this test cares
// about onFirstEdit wiring, not plugin registration.
vi.mock("./blocks/research-meta/research-meta-plugin", () => ({
  researchMetaPlugin: {},
}));

import { renderNoteEditor } from "./NoteEditor.test-rig";

describe("NoteEditor.onFirstEdit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fires on paste into the editor body", () => {
    const onFirstEdit = vi.fn();
    renderNoteEditor({ onFirstEdit });
    const body = screen.getByTestId("note-body");
    fireEvent.paste(body, { clipboardData: { getData: () => "hello" } });
    expect(onFirstEdit).toHaveBeenCalledOnce();
  });

  it("fires on drop into the editor body", () => {
    const onFirstEdit = vi.fn();
    renderNoteEditor({ onFirstEdit });
    const body = screen.getByTestId("note-body");
    fireEvent.drop(body, { dataTransfer: { files: [], types: ["text/plain"] } });
    expect(onFirstEdit).toHaveBeenCalledOnce();
  });

  it("does not fire twice when keystroke + paste happen in sequence", () => {
    const onFirstEdit = vi.fn();
    renderNoteEditor({ onFirstEdit });
    const body = screen.getByTestId("note-body");
    fireEvent.keyDown(body, { key: "a" });
    fireEvent.paste(body, { clipboardData: { getData: () => "x" } });
    expect(onFirstEdit).toHaveBeenCalledOnce();
  });

  it("is a no-op in readOnly mode", () => {
    const onFirstEdit = vi.fn();
    renderNoteEditor({ onFirstEdit, readOnly: true });
    const body = screen.getByTestId("note-body");
    fireEvent.paste(body, { clipboardData: { getData: () => "x" } });
    expect(onFirstEdit).not.toHaveBeenCalled();
  });
});
