import { fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";

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
  CommentsPanel: ({ onClose }: { onClose?: () => void }) => (
    <aside aria-label="댓글 패널" data-testid="comments-panel">
      {onClose ? (
        <button type="button" onClick={onClose}>
          댓글 닫기
        </button>
      ) : null}
    </aside>
  ),
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

// mermaid-plugin also calls `createPlatePlugin` at module scope.
// Same treatment: stub it out so the platejs/react partial mock holds.
vi.mock("./blocks/mermaid/mermaid-plugin", () => ({
  MermaidPlugin: {},
}));

// callout-plugin also calls `createPlatePlugin` at module scope.
// Same treatment: stub it out so the platejs/react partial mock holds.
vi.mock("./blocks/callout/callout-plugin", () => ({
  CalloutPlugin: {},
}));

// toggle-plugin also calls `createPlatePlugin` at module scope.
// Same treatment: stub it out so the platejs/react partial mock holds.
vi.mock("./blocks/toggle/toggle-plugin", () => ({
  TogglePlugin: {},
}));

// table-plugin re-exports @platejs/table/react plugins. Stub to empty array
// so the platejs/react partial mock holds for this headless test suite.
vi.mock("./blocks/table/table-plugin", () => ({ tablePlugins: [] }));

// columns-plugin re-exports @platejs/layout/react plugins. Stub to empty
// array so the platejs/react partial mock holds for this headless test suite.
vi.mock("./blocks/columns/columns-plugin", () => ({ columnsPlugins: [] }));

// mermaid-fence calls `createPlatePlugin` at module scope. Stub to an empty
// object so the platejs/react partial mock holds for this headless test suite.
vi.mock("./plugins/mermaid-fence", () => ({ MermaidFencePlugin: {} }));

// paste-norm calls `createPlatePlugin` at module scope. Same treatment.
vi.mock("./plugins/paste-norm", () => ({ PasteNormPlugin: {} }));

// math-trigger calls `createPlatePlugin` at module scope. Same treatment.
vi.mock("./plugins/math-trigger", () => ({ mathTriggerPlugin: {} }));

// embed/image plugins also call `createPlatePlugin` at module scope.
vi.mock("./blocks/embed/embed-plugin", () => ({ embedPlugin: {} }));
vi.mock("./blocks/image/image-plugin", () => ({ imagePlugin: {} }));
vi.mock("./plugins/image-drop-deferred", () => ({
  imageDropDeferredPlugin: {},
  useImageUploadDeferredToast: () => undefined,
}));

import { renderNoteEditor } from "./NoteEditor.test-rig";

describe("NoteEditor.onFirstEdit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAgentWorkbenchStore.setState(useAgentWorkbenchStore.getInitialState(), true);
    usePanelStore.setState(usePanelStore.getInitialState(), true);
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
    fireEvent.drop(body, {
      dataTransfer: { files: [], types: ["text/plain"] },
    });
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

  it("renders note actions as compact icon controls", () => {
    renderNoteEditor();
    expect(screen.getByTestId("note-actions")).toBeInTheDocument();
    expect(screen.getByTestId("share-button")).toHaveAttribute("aria-label", "공유");
    expect(screen.getByTestId("share-button").className).toContain("h-8");
    expect(screen.getByTestId("share-button")).toHaveTextContent("");
  });

  it("keeps comments closed by default and opens them from the title row", () => {
    renderNoteEditor();

    expect(
      screen.queryByRole("complementary", { name: "댓글 패널" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("comments-toggle-button"));

    expect(screen.getByRole("complementary", { name: "댓글 패널" })).toBeInTheDocument();
  });

  it("renders a note-local AI entrypoint next to note actions", () => {
    renderNoteEditor();

    const aiButton = screen.getByTestId("ask-ai-note-button");
    expect(aiButton).toHaveAttribute("aria-label", "AI에게 질문");
    expect(aiButton).toHaveTextContent("");
  });

  it("opens the agent panel with current-note context for note-local AI entrypoints", async () => {
    usePanelStore.getState().setAgentPanelOpen(false);
    renderNoteEditor();

    await userEvent.click(screen.getByTestId("ask-ai-note-button"));

    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "applyContext",
      commandId: "current_document_only",
    });
  });

  it("opens activity review from the note toolbar without navigating away", async () => {
    renderNoteEditor();

    await userEvent.click(screen.getByTestId("review-note-actions-button"));

    expect(usePanelStore.getState().agentPanelTab).toBe("activity");
  });

  it("queues narration from the note toolbar in the current workbench", async () => {
    renderNoteEditor();

    await userEvent.click(screen.getByTestId("narrate-note-button"));

    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "runCommand",
      commandId: "narrate_note",
    });
  });

  it("keeps the note contextual rail closed by default", () => {
    renderNoteEditor();

    expect(screen.getByTestId("note-context-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("comments-panel")).not.toBeInTheDocument();
  });

  it("opens comments inside the note contextual rail on demand", async () => {
    renderNoteEditor();

    await userEvent.click(screen.getByTestId("note-rail-comments-button"));

    expect(screen.getByTestId("comments-panel")).toBeInTheDocument();
  });

  it("runs note-local AI actions from the contextual rail", async () => {
    usePanelStore.getState().setAgentPanelOpen(false);
    renderNoteEditor();

    await userEvent.click(screen.getByTestId("note-rail-ai-button"));
    await userEvent.click(screen.getByTestId("note-rail-ask-ai-button"));

    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "applyContext",
      commandId: "current_document_only",
    });
  });
});
