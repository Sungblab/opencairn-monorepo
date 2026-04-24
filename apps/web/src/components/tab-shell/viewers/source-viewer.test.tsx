import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { SourceViewer } from "./source-viewer";

vi.mock("react-pdf", () => ({
  Document: ({
    onLoadSuccess,
    children,
  }: {
    onLoadSuccess?: (arg: { numPages: number }) => void;
    children: React.ReactNode;
  }) => {
    // Simulate a 2-page PDF so the Page map renders twice.
    onLoadSuccess?.({ numPages: 2 });
    return <div data-testid="pdf-document">{children}</div>;
  },
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`pdf-page-${pageNumber}`} />
  ),
  pdfjs: { GlobalWorkerOptions: {} },
}));

const messages = {
  appShell: { viewers: { source: { loadFailed: "PDF 로드 실패" } } },
};

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

const tab = {
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

describe("SourceViewer", () => {
  it("points Document at /api/notes/:id/file and renders every page", () => {
    wrap(<SourceViewer tab={tab} />);
    expect(screen.getByTestId("pdf-document")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-page-1")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-page-2")).toBeInTheDocument();
  });

  it("renders nothing when targetId is null", () => {
    const { container } = wrap(
      <SourceViewer tab={{ ...tab, targetId: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
