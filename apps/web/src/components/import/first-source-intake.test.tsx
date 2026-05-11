import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FirstSourceIntake } from "./first-source-intake";
import { useTabsStore } from "@/stores/tabs-store";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  upload: vi.fn(),
  startRun: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (namespace?: string) => {
    const messages: Record<string, string> = {
      "import.firstSource.title": "자료 하나만 넣으면 시작할 수 있어요.",
      "import.firstSource.description": "파일, 링크, 텍스트 중 하나를 넣으면 OpenCairn이 읽고 다음 질문을 준비합니다.",
      "import.firstSource.tabs.file": "파일",
      "import.firstSource.tabs.link": "링크",
      "import.firstSource.tabs.text": "텍스트",
      "import.firstSource.file.label": "파일 업로드",
      "import.firstSource.file.hint": "PDF, 문서, 이미지, 오디오, 영상, Markdown 파일을 올릴 수 있어요.",
      "import.firstSource.file.empty": "파일을 선택하세요",
      "import.firstSource.file.selected": "선택됨: {name}",
      "import.firstSource.link.label": "자료 링크",
      "import.firstSource.link.placeholder": "https://example.com/article",
      "import.firstSource.text.titleLabel": "노트 제목",
      "import.firstSource.text.titlePlaceholder": "회의록, 초안, 메모",
      "import.firstSource.text.label": "붙여넣을 텍스트",
      "import.firstSource.text.placeholder": "정리할 내용을 그대로 붙여넣으세요.",
      "import.firstSource.pipeline.read": "자료 읽는 중",
      "import.firstSource.pipeline.extract": "핵심 내용 정리 중",
      "import.firstSource.pipeline.questions": "추천 질문 만드는 중",
      "import.firstSource.pipeline.note": "첫 노트 준비 중",
      "import.firstSource.projectName.file": "업로드 자료",
      "import.firstSource.projectName.link": "링크 자료",
      "import.firstSource.projectName.text": "붙여넣은 텍스트",
      "import.firstSource.actions.start": "분석 시작",
      "import.firstSource.actions.starting": "시작 중...",
      "import.firstSource.errors.workspace": "워크스페이스를 찾지 못했습니다.",
      "import.firstSource.errors.project": "프로젝트를 만들지 못했습니다.",
      "import.firstSource.errors.fileRequired": "먼저 파일을 선택하세요.",
      "import.firstSource.errors.linkRequired": "먼저 링크를 입력하세요.",
      "import.firstSource.errors.linkInvalid": "http 또는 https 링크를 입력하세요.",
      "import.firstSource.errors.textRequired": "먼저 텍스트를 입력하세요.",
      "import.firstSource.errors.generic": "시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
    return (key: string, values?: Record<string, string>) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      let value = messages[fullKey] ?? fullKey;
      for (const [name, replacement] of Object.entries(values ?? {})) {
        value = value.replace(`{${name}}`, replacement);
      }
      return value;
    };
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/hooks/useWorkspaceId", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("@/hooks/use-ingest-upload", () => ({
  useIngestUpload: () => ({ upload: mocks.upload, isUploading: false, error: null }),
}));

vi.mock("@/stores/ingest-store", () => ({
  useIngestStore: { getState: () => ({ startRun: mocks.startRun }) },
}));

vi.mock("./target-picker", () => ({
  TargetPicker: () => <div>target picker</div>,
}));

describe("FirstSourceIntake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upload.mockResolvedValue({
      workflowId: "ingest-file-1",
      objectKey: "uploads/user/source.pdf",
      sourceBundleNodeId: null,
      originalFileId: null,
    });
    useTabsStore.setState({
      workspaceId: null,
      tabs: [],
      activeId: null,
      closedStack: [],
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/workspaces/ws-1/projects") {
        return Response.json({ id: "project-1", name: "링크 자료" }, { status: 201 });
      }
      if (url === "/api/ingest/url") {
        return Response.json({ workflowId: "ingest-url-1" }, { status: 202 });
      }
      if (url === "/api/notes") {
        return Response.json(
          { id: "note-1", projectId: "project-1", title: "회의록" },
          { status: 201 },
        );
      }
      return Response.json({}, { status: 404 });
    }) as typeof fetch;
  });

  it("shows file, link, and text as equal first-source choices", () => {
    const { rerender } = render(
      <FirstSourceIntake wsSlug="home-1234abcd" initialMode="file" />,
    );

    expect(screen.getByRole("tab", { name: "파일" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "링크" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "텍스트" })).toBeInTheDocument();
    expect(screen.getByLabelText("파일 업로드")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "분석 시작" })).toBeDisabled();

    rerender(<FirstSourceIntake wsSlug="home-1234abcd" initialMode="link" />);
    expect(screen.getByRole("tab", { name: "링크" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("uploads a selected file without opening a live ingest tab", async () => {
    const user = userEvent.setup();
    render(<FirstSourceIntake wsSlug="home-1234abcd" initialMode="file" />);

    const source = new File(["pdf"], "source.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("파일 업로드"), source);
    await user.click(screen.getByRole("button", { name: "분석 시작" }));

    await waitFor(() => {
      expect(mocks.upload).toHaveBeenCalledWith(source, "project-1");
    });
    expect(useTabsStore.getState().tabs.some((tab) => tab.kind === "ingest")).toBe(
      false,
    );
    expect(mocks.push).toHaveBeenCalledWith("/ko/workspace/home-1234abcd");
  });

  it("opens the original PDF file tab before leaving the import page", async () => {
    mocks.upload.mockResolvedValueOnce({
      workflowId: "ingest-file-1",
      objectKey: "uploads/user/source.pdf",
      sourceBundleNodeId: "00000000-0000-0000-0000-000000000010",
      originalFileId: "00000000-0000-0000-0000-000000000011",
    });
    const user = userEvent.setup();
    render(<FirstSourceIntake wsSlug="home-1234abcd" initialMode="file" />);

    const source = new File(["pdf"], "source.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("파일 업로드"), source);
    await user.click(screen.getByRole("button", { name: "분석 시작" }));

    await waitFor(() => {
      expect(useTabsStore.getState().activeId).not.toBeNull();
    });
    expect(useTabsStore.getState().tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent_file",
          targetId: "00000000-0000-0000-0000-000000000011",
          title: "source.pdf",
          mode: "agent-file",
          preview: false,
        }),
      ]),
    );
    expect(useTabsStore.getState().tabs.some((tab) => tab.kind === "ingest")).toBe(
      false,
    );
  });

  it("starts web-url ingest from the link mode without opening a live ingest tab", async () => {
    const user = userEvent.setup();
    render(<FirstSourceIntake wsSlug="home-1234abcd" initialMode="link" />);

    await user.type(screen.getByLabelText("자료 링크"), "https://example.com/article");
    await user.click(screen.getByRole("button", { name: "분석 시작" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/ingest/url",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        }),
      );
    });
    expect(mocks.startRun).toHaveBeenCalledWith(
      "ingest-url-1",
      "x-opencairn/web-url",
      "example.com",
    );
    expect(useTabsStore.getState().tabs.some((tab) => tab.kind === "ingest")).toBe(
      false,
    );
    expect(mocks.push).toHaveBeenCalledWith("/ko/workspace/home-1234abcd");
  });

  it("does not classify arbitrary youtube.com suffixes as YouTube ingest", async () => {
    const user = userEvent.setup();
    render(<FirstSourceIntake wsSlug="home-1234abcd" initialMode="link" />);

    await user.type(screen.getByLabelText("자료 링크"), "https://evil-youtube.com/watch");
    await user.click(screen.getByRole("button", { name: "분석 시작" }));

    await waitFor(() => {
      expect(mocks.startRun).toHaveBeenCalledWith(
        "ingest-url-1",
        "x-opencairn/web-url",
        "evil-youtube.com",
      );
    });
  });

  it("rejects invalid links before creating an empty project", async () => {
    const user = userEvent.setup();
    render(<FirstSourceIntake wsSlug="home-1234abcd" initialMode="link" />);

    await user.type(screen.getByLabelText("자료 링크"), "not-a-link");
    await user.click(screen.getByRole("button", { name: "분석 시작" }));

    expect(await screen.findByText("http 또는 https 링크를 입력하세요.")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("turns pasted text into a source note and routes to the created note", async () => {
    const user = userEvent.setup();
    render(<FirstSourceIntake wsSlug="home-1234abcd" initialMode="text" />);

    await user.type(screen.getByLabelText("노트 제목"), "회의록");
    fireEvent.change(screen.getByLabelText("붙여넣을 텍스트"), {
      target: { value: "오늘 논의한 의사결정과 후속 작업을 정리합니다." },
    });
    await user.click(screen.getByRole("button", { name: "분석 시작" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/notes",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        }),
      );
    });
    expect(mocks.push).toHaveBeenCalledWith(
      "/ko/workspace/home-1234abcd/project/project-1/note/note-1",
    );
  });
});
