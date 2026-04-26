import { markdownToPlate } from "@/lib/markdown/markdown-to-plate";
import { useActiveEditorStore } from "@/stores/activeEditorStore";

// Plan 2D — Insert a markdown blob into a Plate editor (or invoke the
// missing-target callback so the caller can offer "create new note").
//
// Decoupled from React/UI: caller passes callbacks for success / missing
// target / error. The save-suggestion-card wires those to toasts and an
// API client; tests inject mocks.

interface CreateNoteApi {
  (input: { title: string; content: unknown[] }): Promise<{
    id: string;
    title: string;
  }>;
}

interface InsertFromMarkdownArgs {
  markdown: string;
  /** The currently active tab's noteId, or undefined if no tab is focused. */
  activeNoteId: string | undefined;
  /** True iff the active tab is rendering a Plate note (mode === 'plate'). */
  activeNoteIsPlate: boolean;
  apiCreateNote: CreateNoteApi;
  onSuccess: () => void;
  onMissingTarget: () => void;
  onCreatedNote: (note: { id: string; title: string }) => void;
  onError: (err: unknown) => void;
}

export async function insertFromMarkdown(args: InsertFromMarkdownArgs) {
  const {
    markdown,
    activeNoteId,
    activeNoteIsPlate,
    onSuccess,
    onMissingTarget,
    onError,
  } = args;

  if (!activeNoteId || !activeNoteIsPlate) {
    onMissingTarget();
    return;
  }
  const editor = useActiveEditorStore.getState().getEditor(activeNoteId);
  if (!editor) {
    onMissingTarget();
    return;
  }

  try {
    const ast = markdownToPlate(markdown);
    const at = editor.api.end?.();
    editor.tf.insertNodes(ast as never, at ? ({ at } as never) : undefined);
    onSuccess();
  } catch (err) {
    onError(err);
  }
}

interface CreateNoteFromMarkdownArgs {
  title: string;
  markdown: string;
  apiCreateNote: CreateNoteApi;
  onCreated: (note: { id: string; title: string }) => void;
  onError: (err: unknown) => void;
}

export async function createNoteFromMarkdown(args: CreateNoteFromMarkdownArgs) {
  const { title, markdown, apiCreateNote, onCreated, onError } = args;
  try {
    const ast = markdownToPlate(markdown);
    const note = await apiCreateNote({ title, content: ast });
    onCreated(note);
  } catch (err) {
    onError(err);
  }
}
