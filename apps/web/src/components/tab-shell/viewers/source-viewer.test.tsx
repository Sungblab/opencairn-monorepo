import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type { Tab } from "@/stores/tabs-store";
import { SourceViewer } from "./source-viewer";

const tab: Tab = {
  id: "t",
  kind: "note" as const,
  targetId: "n1",
  mode: "source" as const,
  title: "doc.pdf",
  titleKey: undefined,
  titleParams: undefined,
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null as "left" | "right" | null,
  scrollY: 0,
};

const messages = {
  appShell: {
    viewers: {
      source: {
        title: "원본 PDF",
        frameTitle: "{title} PDF 뷰어",
        open: "새 탭에서 열기",
        download: "다운로드",
        refresh: "새로고침",
        fallbackTitle: "PDF 미리보기를 표시할 수 없습니다.",
        fallbackOpen: "새 탭에서 열기",
      },
    },
  },
};

function renderSourceViewer(nextTab: Tab = tab) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <SourceViewer tab={nextTab} />
    </NextIntlClientProvider>,
  );
}

describe("SourceViewer", () => {
  it("embeds the note file in the browser-native PDF viewer", () => {
    renderSourceViewer();
    const viewer = screen.getByTestId("pdf-frame");

    expect(viewer).toBeInTheDocument();
    expect(viewer.getAttribute("data")).toBe(
      "/api/notes/n1/file#toolbar=1&navpanes=1&scrollbar=1&view=FitH",
    );
    expect(viewer).toHaveAttribute("type", "application/pdf");
  });

  it("renders nothing when targetId is null", () => {
    const { container } = renderSourceViewer({ ...tab, targetId: null });
    expect(container.firstChild).toBeNull();
  });

  it("keeps open and download actions on the raw file URL", () => {
    renderSourceViewer();

    expect(screen.getByLabelText("새 탭에서 열기")).toHaveAttribute(
      "href",
      "/api/notes/n1/file",
    );
    expect(screen.getByLabelText("다운로드")).toHaveAttribute(
      "href",
      "/api/notes/n1/file",
    );
    expect(screen.getByLabelText("다운로드")).toHaveAttribute(
      "download",
      "doc.pdf",
    );
  });

  it("refreshes the embedded PDF without changing the source URL", () => {
    renderSourceViewer();
    const viewer = screen.getByTestId("pdf-frame");
    expect(viewer).toHaveAttribute("data-reload-seq", "0");

    fireEvent.click(screen.getByLabelText("새로고침"));

    const refreshed = screen.getByTestId("pdf-frame");
    expect(refreshed).toHaveAttribute("data-reload-seq", "1");
    expect(refreshed.getAttribute("data")).toBe(viewer.getAttribute("data"));
  });
});
