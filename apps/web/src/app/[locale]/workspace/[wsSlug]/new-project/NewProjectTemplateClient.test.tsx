import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NewProjectTemplateClient } from "./NewProjectTemplateClient";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const labels = {
  title: "새 프로젝트 만들기",
  description: "템플릿 설명",
  galleryLabel: "프로젝트 템플릿",
  error: "템플릿 실패",
  templates: {
    empty_project: {
      title: "내 첫 프로젝트",
      description: "빈 프로젝트",
      projectCount: "1개 프로젝트",
    },
    school_subjects: {
      title: "국어 · 수학 · 영어 · 과학",
      description: "과목 템플릿",
      projectCount: "4개 프로젝트",
    },
    korean: {
      title: "국어",
      description: "국어 템플릿",
      projectCount: "1개 프로젝트",
    },
    math: {
      title: "수학",
      description: "수학 템플릿",
      projectCount: "1개 프로젝트",
    },
    english: {
      title: "영어",
      description: "영어 템플릿",
      projectCount: "1개 프로젝트",
    },
    science: {
      title: "과학",
      description: "과학 템플릿",
      projectCount: "1개 프로젝트",
    },
    research: {
      title: "리서치 프로젝트",
      description: "리서치 템플릿",
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
  },
};

describe("NewProjectTemplateClient", () => {
  beforeEach(() => {
    push.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { projects: [{ id: "project-1", name: "국어", notes: [] }] },
          { status: 201 },
        ),
      ),
    );
  });

  it("applies the selected template and opens the first created project", async () => {
    render(
      <NewProjectTemplateClient
        locale="ko"
        wsSlug="acme"
        workspaceId="workspace-1"
        labels={labels}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: /국어 · 수학 · 영어 · 과학/,
      }),
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/project-templates/apply",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ templateId: "school_subjects" }),
        }),
      );
      expect(push).toHaveBeenCalledWith("/ko/workspace/acme/project/project-1");
    });
  });
});
