import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceViewer } from "./source-viewer";

// Shallow-mock @react-pdf-viewer/core. The real Viewer mounts pdfjs +
// a web worker which jsdom can't run; we only need to assert that
// SourceViewer wires the right fileUrl into Viewer and gates on
// targetId.
vi.mock("@react-pdf-viewer/core", () => ({
  Worker: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pdf-worker">{children}</div>
  ),
  Viewer: ({ fileUrl }: { fileUrl: string }) => (
    <div data-testid="pdf-viewer" data-file-url={fileUrl} />
  ),
}));

vi.mock("@react-pdf-viewer/default-layout", () => ({
  // Return a sentinel object so SourceViewer can pass it to Viewer's
  // `plugins` array without caring about its internal shape.
  defaultLayoutPlugin: () => ({ install: () => {}, uninstall: () => {} }),
}));

// The core + default-layout CSS imports are side-effect only. jsdom's
// vite env doesn't load CSS; the import gets hoisted and vitest treats
// it as empty, which is fine.

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
  it("mounts the Viewer with fileUrl=/api/notes/:id/file", () => {
    render(<SourceViewer tab={tab} />);
    const viewer = screen.getByTestId("pdf-viewer");
    expect(viewer).toBeInTheDocument();
    expect(viewer.getAttribute("data-file-url")).toBe("/api/notes/n1/file");
  });

  it("wraps the Viewer in a Worker", () => {
    render(<SourceViewer tab={tab} />);
    expect(screen.getByTestId("pdf-worker")).toBeInTheDocument();
  });

  it("renders nothing when targetId is null", () => {
    const { container } = render(
      <SourceViewer tab={{ ...tab, targetId: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
