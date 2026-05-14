import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabsStore } from "@/stores/tabs-store";
import { SourceUploadButton } from "./SourceUploadButton";

const uploadMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => {
    const messages: Record<string, string> = {
      "sidebar.upload_source": "업로드",
      "sidebar.upload.title": "파일 업로드",
      "sidebar.upload.description": "PDF는 원본을 먼저 열고 분석은 백그라운드에서 진행합니다.",
      "sidebar.upload.drop": "파일을 드래그하거나 클릭해서 선택하세요",
      "sidebar.upload.hint": "PDF, 문서, 이미지, 오디오, 영상, Markdown",
      "sidebar.upload.selected": "선택됨: {name}",
      "sidebar.upload.start": "업로드 시작",
      "sidebar.upload.uploading": "업로드 중...",
      "sidebar.upload.error": "업로드에 실패했어요.",
    };
    return (key: string, values?: Record<string, string>) => {
      const fullKey = ns ? `${ns}.${key}` : key;
      let value = messages[fullKey] ?? fullKey;
      for (const [name, replacement] of Object.entries(values ?? {})) {
        value = value.replace(`{${name}}`, replacement);
      }
      return value;
    };
  },
}));

vi.mock("@/hooks/use-ingest-upload", () => ({
  useIngestUpload: () => ({
    upload: uploadMock,
    uploadMany: async (files: Iterable<File> | ArrayLike<File>, projectId: string) =>
      Promise.all(
        Array.from(files).map(async (file) => ({
          file,
          ok: true,
          result: await uploadMock(file, projectId),
        })),
      ),
    isUploading: false,
    error: null,
  }),
}));

describe("SourceUploadButton", () => {
  beforeEach(() => {
    uploadMock.mockReset();
    uploadMock.mockResolvedValue({
      workflowId: "ingest-wf-1",
      objectKey: "uploads/u/paper.pdf",
      sourceBundleNodeId: "bundle-1",
      originalFileId: "file-1",
    });
    useTabsStore.setState(useTabsStore.getInitialState(), true);
  });

  it("opens the original file tab without creating an ingest progress tab", async () => {
    const user = userEvent.setup();
    render(<SourceUploadButton projectId="project-1" />);

    await user.click(screen.getByRole("button", { name: "업로드" }));
    const input = document.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    const file = new File(["pdf"], "paper.pdf", { type: "application/pdf" });
    await user.upload(input as HTMLInputElement, file);
    await user.click(screen.getByRole("button", { name: "업로드 시작" }));

    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalledWith(file, "project-1");
    });

    const tabs = useTabsStore.getState().tabs;
    expect(tabs.some((tab) => tab.kind === "ingest")).toBe(false);
    expect(tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent_file",
          targetId: "file-1",
          title: "paper.pdf",
          mode: "agent-file",
        }),
      ]),
    );
    expect(useTabsStore.getState().activeId).toBe(
      tabs.find((tab) => tab.kind === "agent_file")?.id,
    );
  });

  it("ignores repeated start clicks while an upload is in flight", async () => {
    const user = userEvent.setup();
    let resolveUpload: (value: {
      workflowId: string;
      objectKey: string;
      sourceBundleNodeId: string | null;
      originalFileId: string | null;
    }) => void = () => {};
    uploadMock.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    render(<SourceUploadButton projectId="project-1" />);

    await user.click(screen.getByRole("button", { name: "업로드" }));
    const input = document.querySelector('input[type="file"]');
    const file = new File(["pdf"], "paper.pdf", { type: "application/pdf" });
    await user.upload(input as HTMLInputElement, file);

    const start = screen.getByRole("button", { name: "업로드 시작" });
    await user.click(start);
    await user.click(start);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(start).toBeDisabled();

    resolveUpload({
      workflowId: "ingest-wf-1",
      objectKey: "uploads/u/paper.pdf",
      sourceBundleNodeId: "bundle-1",
      originalFileId: "file-1",
    });
  });
});
