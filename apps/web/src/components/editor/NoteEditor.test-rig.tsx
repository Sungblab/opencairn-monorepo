import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { NoteEditor, type NoteEditorProps } from "./NoteEditor";

// Heavy dependencies are shallow-mocked via vi.mock in the spec file; this
// rig only wires providers the component assumes at render. See the test
// file for the actual mock set.

const messages = {
  editor: {
    placeholder: { body: "내용 입력", title: "제목" },
    save: { saving: "저장 중", saved: "저장됨", failed: "저장 실패" },
  },
  shareDialog: {
    title: "공유",
  },
};

const defaults: NoteEditorProps = {
  noteId: "n1",
  initialTitle: "T",
  wsSlug: "ws",
  workspaceId: "w1",
  projectId: "p1",
  userId: "u1",
  userName: "U",
  readOnly: false,
  canComment: true,
};

export function renderNoteEditor(
  props: Partial<NoteEditorProps> = {},
): RenderResult {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={messages}>
        <NoteEditor {...defaults} {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
