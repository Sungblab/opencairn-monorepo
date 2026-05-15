import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NewProjectTemplateClient } from "./NewProjectTemplateClient";

const push = vi.fn();
const refresh = vi.fn();
const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  openOriginalFileTab: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("@/hooks/use-ingest-upload", () => ({
  useIngestUpload: () => ({
    upload: mocks.upload,
    isUploading: false,
    error: null,
  }),
}));

vi.mock("@/components/ingest/open-original-file-tab", () => ({
  openOriginalFileTab: mocks.openOriginalFileTab,
}));

const labels = {
  title: "새 프로젝트 만들기",
  description: "템플릿 설명",
  galleryLabel: "프로젝트 템플릿",
  error: "템플릿 실패",
  quickCreate: {
    label: "프로젝트 이름",
    placeholder: "프로젝트 이름 입력",
    button: "프로젝트 만들기",
  },
  imageCreate: {
    title: "파일이나 이미지로 시작",
    description: "시간표 사진을 추가합니다",
    pick: "파일 선택",
    change: "파일 바꾸기",
    button: "프로젝트 만들고 자료 추가",
  },
  templates: {
    empty_project: {
      title: "빈 프로젝트",
      description: "빈 프로젝트",
      projectCount: "빈 프로젝트",
    },
    research: {
      title: "리서치 프로젝트",
      description: "리서치 템플릿",
      projectCount: "1개 프로젝트",
    },
    source_library: {
      title: "자료 분석 프로젝트",
      description: "자료 분석 템플릿",
      projectCount: "1개 프로젝트",
    },
    meeting: {
      title: "회의 노트",
      description: "회의 템플릿",
      projectCount: "1개 프로젝트",
    },
    personal_knowledge: {
      title: "개인 지식 창고",
      description: "개인 지식 템플릿",
      projectCount: "1개 프로젝트",
    },
    team_project: {
      title: "팀 프로젝트",
      description: "팀 프로젝트 템플릿",
      projectCount: "1개 프로젝트",
    },
  },
};

describe("NewProjectTemplateClient", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    mocks.upload.mockReset();
    mocks.openOriginalFileTab.mockReset();
    mocks.upload.mockResolvedValue({
      workflowId: "ingest-1",
      objectKey: "uploads/image.png",
      sourceBundleNodeId: null,
      originalFileId: "file-1",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/workspaces/workspace-1/projects")) {
          return Response.json(
            { id: "project-1", name: "논문 리서치", workspaceId: "workspace-1" },
            { status: 201 },
          );
        }
        return Response.json(
          { projects: [{ id: "project-1", name: "리서치 프로젝트", notes: [] }] },
          { status: 201 },
        );
      }),
    );
  });

  function renderClient() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <NewProjectTemplateClient
          locale="ko"
          wsSlug="acme"
          workspaceId="workspace-1"
          labels={labels}
        />
      </QueryClientProvider>,
    );
  }

  it("applies the selected template and opens the first created project", async () => {
    renderClient();

    await userEvent.click(
      screen.getByRole("button", {
        name: /리서치 프로젝트/,
      }),
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/project-templates/apply",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ templateId: "research" }),
        }),
      );
      expect(push).toHaveBeenCalledWith("/ko/workspace/acme/project/project-1");
    });
  });

  it("keeps the new-project page inside narrow shell width", () => {
    renderClient();

    const root = screen.getByTestId("new-project-template-root");
    const gallery = screen.getByLabelText("프로젝트 템플릿");
    expect(root).toHaveClass("w-full", "min-w-0", "overflow-x-hidden");
    expect(gallery.className).toContain("auto-fit");
    expect(gallery.className).not.toContain("xl:grid-cols-3");
  });

  it("creates a named blank project directly", async () => {
    renderClient();

    await userEvent.type(screen.getByLabelText("프로젝트 이름"), "논문 리서치");
    await userEvent.click(screen.getByRole("button", { name: "프로젝트 만들기" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/projects",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "논문 리서치" }),
        }),
      );
      expect(push).toHaveBeenCalledWith("/ko/workspace/acme/project/project-1");
    });
  });

  it("creates a project from a selected image and uploads it", async () => {
    renderClient();

    const file = new File(["image"], "시간표.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("파일 선택"), file);
    await userEvent.click(
      screen.getByRole("button", { name: "프로젝트 만들고 자료 추가" }),
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/projects",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "시간표" }),
        }),
      );
      expect(mocks.upload).toHaveBeenCalledWith(file, "project-1");
      expect(mocks.openOriginalFileTab).toHaveBeenCalledWith("file-1", "시간표.png");
      expect(push).toHaveBeenCalledWith("/ko/workspace/acme/project/project-1");
    });
  });
});
