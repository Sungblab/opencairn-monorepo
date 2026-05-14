import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectMainDropZone } from "./project-main-drop-zone";

const uploadManyMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations:
    (ns?: string) => (key: string, values?: Record<string, unknown>) => {
      const fullKey = ns ? `${ns}.${key}` : key;
      if (key === "selected") return `${fullKey}:${String(values?.name)}`;
      return fullKey;
    },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "acme" }),
  usePathname: () => "/ko/workspace/acme/project/project-1",
}));

vi.mock("@/hooks/use-ingest-upload", () => ({
  useIngestUpload: () => ({
    uploadMany: uploadManyMock,
    isUploading: false,
    error: null,
  }),
}));

describe("ProjectMainDropZone", () => {
  beforeEach(() => {
    uploadManyMock.mockReset();
    uploadManyMock.mockResolvedValue([
      {
        file: new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        ok: true,
        result: {
          workflowId: "wf-1",
          objectKey: "uploads/paper.pdf",
          sourceBundleNodeId: "bundle-1",
          originalFileId: null,
        },
      },
    ]);
  });

  it("shows a workspace overlay and opens the shared upload dialog on file drop", async () => {
    const file = new File(["pdf"], "paper.pdf", { type: "application/pdf" });

    render(
      <ProjectMainDropZone>
        <main data-testid="main-surface">project surface</main>
      </ProjectMainDropZone>,
    );

    const surface = screen.getByTestId("main-surface").parentElement!;
    fireEvent.dragEnter(surface, {
      dataTransfer: { files: [file], types: ["Files"] },
    });

    expect(screen.getByTestId("app-shell-upload-overlay")).toHaveTextContent(
      "sidebar.upload.dropMain",
    );

    fireEvent.drop(surface, {
      dataTransfer: { files: [file], types: ["Files"] },
    });

    expect(
      screen.queryByTestId("app-shell-upload-overlay"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("sidebar.upload.title")).toBeInTheDocument();
    expect(
      screen.getByText("sidebar.upload.selected:paper.pdf"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "sidebar.upload.start" }),
    );

    await waitFor(() => {
      expect(uploadManyMock).toHaveBeenCalledWith([file], "project-1", {
        concurrency: 3,
      });
    });
  });
});
