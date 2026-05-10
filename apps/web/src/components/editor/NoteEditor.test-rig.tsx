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
    toolbar: {
      agents: "AI 작업",
      comments: "댓글",
      ask_ai: "AI에게 질문",
      narrate: "오디오 생성",
      review_ai_work: "검토",
    },
    noteRail: {
      title: "노트 패널",
      close: "닫기",
      comments: "댓글",
      ai: "AI 작업",
      aiWork: "AI 작업",
      activity: "활동",
      askAi: "AI에게 질문",
      narrate: "오디오 생성",
      review: "검토",
      aiDescription: "현재 노트 범위를 유지한 채 작업합니다.",
      activityDescription: "이 노트와 프로젝트에서 진행 중인 작업을 봅니다.",
    },
    embed: {},
    image: {},
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
