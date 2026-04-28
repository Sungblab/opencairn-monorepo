import { act, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "@/stores/tabs-store";
import { SourceViewer } from "./source-viewer";

const pdfViewerMock = vi.hoisted(() => ({
  props: [] as Array<{
    config: { src: string };
    style?: React.CSSProperties;
    onReady?: (registry: unknown) => void;
  }>,
}));

vi.mock("@embedpdf/react-pdf-viewer", () => ({
  PDFViewer: (props: {
    config: { src: string };
    style?: React.CSSProperties;
    onReady?: (registry: unknown) => void;
  }) => {
    pdfViewerMock.props.push(props);
    return (
      <div
        data-testid="embedpdf-viewer"
        data-src={props.config.src}
        data-height={props.style?.height}
      />
    );
  },
}));

vi.mock("next/dynamic", () => ({
  default:
    (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) =>
    (props: Record<string, unknown>) => {
      const React = require("react") as typeof import("react");
      const [Component, setComponent] =
        React.useState<React.ComponentType<Record<string, unknown>> | null>(
          null,
        );

      React.useEffect(() => {
        loader().then((loaded) => setComponent(() => loaded));
      }, []);

      if (!Component) return null;
      return <Component {...props} />;
    },
}));

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
  beforeEach(() => {
    pdfViewerMock.props = [];
  });

  it("loads the note file in the EmbedPDF viewer", async () => {
    renderSourceViewer();
    const viewer = await screen.findByTestId("embedpdf-viewer");

    expect(viewer).toBeInTheDocument();
    expect(viewer).toHaveAttribute("data-src", "/api/notes/n1/file");
    expect(viewer).toHaveAttribute("data-height", "100%");
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

  it("emits a viewer-ready event for agent integrations", async () => {
    const listener = vi.fn();
    window.addEventListener("opencairn:source-pdf-ready", listener);

    renderSourceViewer();
    await waitFor(() => expect(pdfViewerMock.props.length).toBeGreaterThan(0));

    act(() => {
      pdfViewerMock.props.at(-1)?.onReady?.({ search: "registry" });
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toMatchObject({
      tabId: "t",
      noteId: "n1",
      title: "doc.pdf",
    });
    expect(event.detail.registry).toEqual({ search: "registry" });

    window.removeEventListener("opencairn:source-pdf-ready", listener);
  });
});
