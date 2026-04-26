import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "../../../messages/ko/canvas.json";
import { CanvasOutputsGallery } from "./CanvasOutputsGallery";

const mockUpload = vi.fn();

vi.mock("@/lib/use-canvas-outputs", () => ({
  useCanvasOutputs: vi.fn(),
}));

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ canvas: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

const NOTE_ID = "n1";

beforeEach(async () => {
  mockUpload.mockReset();
  mockUpload.mockResolvedValue({ id: "o-new", urlPath: "/api/canvas/outputs/o-new/file" });
  const mod = await import("@/lib/use-canvas-outputs");
  (mod.useCanvasOutputs as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe("CanvasOutputsGallery", () => {
  it("renders existing saved outputs", async () => {
    const mod = await import("@/lib/use-canvas-outputs");
    (mod.useCanvasOutputs as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        outputs: [
          {
            id: "o1",
            urlPath: "/api/canvas/outputs/o1/file",
            runId: null,
            mimeType: "image/png",
            bytes: 100,
            createdAt: "2026-04-26T00:00:00Z",
          },
          {
            id: "o2",
            urlPath: "/api/canvas/outputs/o2/file",
            runId: "r1",
            mimeType: "image/png",
            bytes: 200,
            createdAt: "2026-04-26T00:01:00Z",
          },
        ],
      },
      upload: mockUpload,
      uploading: false,
    });

    const { getAllByTestId } = render(
      withIntl(
        <CanvasOutputsGallery
          noteId={NOTE_ID}
          runId={null}
          pendingFigures={[]}
        />,
      ),
    );

    const imgs = getAllByTestId("saved-output");
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute("src")).toBe("/api/canvas/outputs/o1/file");
    expect(imgs[1].getAttribute("src")).toBe("/api/canvas/outputs/o2/file");
  });

  it("clicking Save calls upload with a PNG blob", async () => {
    const mod = await import("@/lib/use-canvas-outputs");
    (mod.useCanvasOutputs as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { outputs: [] },
      upload: mockUpload,
      uploading: false,
    });

    // 4 valid base64 chars decode to 3 bytes ("abc"). The component will
    // wrap that in a Blob and forward it to `upload`.
    const b64 = "YWJj"; // "abc"
    const { getByTestId } = render(
      withIntl(
        <CanvasOutputsGallery
          noteId={NOTE_ID}
          runId="run-1"
          pendingFigures={[b64]}
        />,
      ),
    );

    fireEvent.click(getByTestId("output-save"));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    const arg = mockUpload.mock.calls[0][0];
    expect(arg.blob).toBeInstanceOf(Blob);
    expect((arg.blob as Blob).type).toBe("image/png");
    expect(arg.runId).toBe("run-1");
  });
});
