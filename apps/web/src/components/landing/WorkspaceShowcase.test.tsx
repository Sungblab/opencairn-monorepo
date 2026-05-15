import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceShowcase } from "./WorkspaceShowcase";

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const values: Record<string, unknown> = {
      title1: "워크스페이스",
      title2: "한 화면",
      sub: "자료와 연결을 봅니다.",
      tags: ["PDF", "DOCX"],
      "mock.sideRows": [{ label: "홈", count: "3", active: true }],
      "mock.projects": ["프로젝트"],
      "mock.pageMeta": ["3 notes"],
      "mock.relatedItems": ["근거"],
      "mock.feed": [{ agent: "Agent", text: "정리 완료" }],
      "mock.backlinks": ["관련 노트"],
      "mock.chromePath": "OpenCairn / Workspace",
      "mock.sideWorkspace": "Workspace",
      "mock.sideWorkspaceName": "개인 공간",
      "mock.sideWorkspaceMembers": "1명",
      "mock.sideProjects": "Projects",
      "mock.breadcrumb": "Project",
      "mock.pageTitle": "Research",
      "mock.body": "본문",
      "mock.calloutTitle": "핵심",
      "mock.calloutBody": "내용",
      "mock.related": "관련",
      "mock.railFeedH": "Feed",
      "mock.backlinksH": "Backlinks",
    };
    const t = (key: string) => String(values[key] ?? key);
    t.raw = (key: string) => values[key];
    return t;
  },
}));

describe("WorkspaceShowcase", () => {
  it("does not force a 920px landing mockup on medium mobile widths", () => {
    render(<WorkspaceShowcase />);

    const frame = screen.getByTestId("landing-workspace-frame");
    const mockup = screen.getByTestId("landing-workspace-mockup");

    expect(frame).toHaveClass("overflow-hidden");
    expect(mockup.className).not.toContain("md:min-w-[920px]");
    expect(mockup).toHaveClass("min-w-0", "w-full");
  });
});
