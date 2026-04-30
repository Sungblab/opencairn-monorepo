import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koNote from "@/../messages/ko/note.json";
import { EnrichmentPanel } from "./EnrichmentPanel";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ note: koNote }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("EnrichmentPanel", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders empty state when the API returns 404 (no artifact)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "no_enrichment" }, 404)),
    );
    wrap(<EnrichmentPanel noteId="00000000-0000-0000-0000-000000000001" />);
    expect(
      await screen.findByText(koNote.enrichment.empty),
    ).toBeInTheDocument();
  });

  it("renders outline rows + status badge when artifact is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          noteId: "00000000-0000-0000-0000-000000000002",
          contentType: "paper",
          status: "done",
          provider: "gemini",
          skipReasons: [],
          error: null,
          updatedAt: new Date().toISOString(),
          artifact: {
            outline: [
              { level: 1, title: "Introduction", page: 3 },
              { level: 2, title: "Background", page: 5 },
            ],
            word_count: 4321,
          },
        }),
      ),
    );
    wrap(<EnrichmentPanel noteId="00000000-0000-0000-0000-000000000002" />);
    await waitFor(() =>
      expect(screen.getByText("Introduction")).toBeInTheDocument(),
    );
    expect(screen.getByText("Background")).toBeInTheDocument();
    expect(
      screen.getByTestId("enrichment-status-done"),
    ).toBeInTheDocument();
    // 논문 contentType label
    expect(screen.getByText(koNote.enrichment.contentType.paper)).toBeInTheDocument();
  });

  it("renders skip reasons when the worker reports them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          noteId: "00000000-0000-0000-0000-000000000003",
          contentType: "image",
          status: "done",
          provider: "ollama",
          skipReasons: ["image_provider_unsupported"],
          error: null,
          updatedAt: new Date().toISOString(),
          artifact: {},
        }),
      ),
    );
    wrap(<EnrichmentPanel noteId="00000000-0000-0000-0000-000000000003" />);
    await waitFor(() =>
      expect(
        screen.getByText("image_provider_unsupported"),
      ).toBeInTheDocument(),
    );
  });

  it("renders failed state with generic error message (raw worker error withheld)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          noteId: "00000000-0000-0000-0000-000000000004",
          contentType: "document",
          status: "failed",
          provider: null,
          skipReasons: [],
          // The raw worker string can leak internals (e.g. exception text);
          // the panel must surface a translated generic line instead.
          error: "OCR timed out",
          updatedAt: new Date().toISOString(),
          artifact: null,
        }),
      ),
    );
    wrap(<EnrichmentPanel noteId="00000000-0000-0000-0000-000000000004" />);
    await waitFor(() =>
      expect(
        screen.getByText(koNote.enrichment.failureGeneric),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("OCR timed out")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("enrichment-status-failed"),
    ).toBeInTheDocument();
  });
});
