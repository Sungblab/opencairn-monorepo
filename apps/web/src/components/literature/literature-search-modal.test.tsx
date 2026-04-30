import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koLiterature from "@/../messages/ko/literature.json";
import { LiteratureSearchModal } from "./literature-search-modal";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="ko"
        messages={{ literature: koLiterature }}
      >
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const PAPER = {
  id: "10.1000/x1",
  doi: "10.1000/x1",
  arxivId: null,
  title: "Sample paper",
  authors: ["Alice", "Bob"],
  year: 2024,
  abstract: "An abstract.",
  openAccessPdfUrl: "https://example.org/x1.pdf",
  citationCount: 12,
  alreadyImported: false,
};

describe("LiteratureSearchModal", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders the empty hint before any search runs", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );
    wrap(
      <LiteratureSearchModal
        open
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
      />,
    );
    expect(screen.getByText(koLiterature.modal.emptyHint)).toBeInTheDocument();
  });

  it("submits the query against /api/literature/search and renders results", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/workspaces/ws-1/projects")) {
        return jsonResponse([{ id: "p-1", name: "Project One" }]);
      }
      if (url.includes("/api/literature/search")) {
        return jsonResponse({ results: [PAPER], total: 1 });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    wrap(
      <LiteratureSearchModal
        open
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
      />,
    );

    fireEvent.change(screen.getByTestId("lit-modal-input"), {
      target: { value: "diffusion models" },
    });
    fireEvent.click(screen.getByTestId("lit-modal-search"));

    await waitFor(() =>
      expect(screen.getByText("Sample paper")).toBeInTheDocument(),
    );

    const searchCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/literature/search"),
    );
    expect(searchCall).toBeDefined();
    const calledUrl = String(searchCall![0]);
    expect(calledUrl).toContain("workspaceId=ws-1");
    expect(calledUrl).toContain("q=diffusion%20models");
  });

  it("calls /api/literature/import with selected ids + projectId, then surfaces queued count", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/workspaces/ws-1/projects")) {
        return jsonResponse([
          { id: "p-1", name: "Project One" },
          { id: "p-2", name: "Project Two" },
        ]);
      }
      if (url.includes("/api/literature/search")) {
        return jsonResponse({ results: [PAPER], total: 1 });
      }
      if (url.includes("/api/literature/import")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        expect(body.ids).toEqual(["10.1000/x1"]);
        expect(body.projectId).toBe("p-1");
        return jsonResponse(
          { jobId: "job-1", workflowId: "wf-1", skipped: [], queued: 1 },
          202,
        );
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    wrap(
      <LiteratureSearchModal
        open
        onOpenChange={vi.fn()}
        workspaceId="ws-1"
        defaultProjectId="p-1"
      />,
    );

    fireEvent.change(screen.getByTestId("lit-modal-input"), {
      target: { value: "topic" },
    });
    fireEvent.click(screen.getByTestId("lit-modal-search"));

    const checkbox = await screen.findByTestId(
      "lit-modal-row-10.1000/x1",
    );
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByTestId("lit-modal-import"));

    await waitFor(() =>
      expect(
        screen.getByTestId("lit-modal-import-success"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("lit-modal-import-success").textContent,
    ).toContain("1");

    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).includes("/api/literature/import"),
      ),
    ).toBe(true);
  });

  it("disables search when workspaceId is null and shows the missing-workspace hint", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );
    wrap(
      <LiteratureSearchModal
        open
        onOpenChange={vi.fn()}
        workspaceId={null}
      />,
    );
    expect(
      screen.getByText(koLiterature.modal.missingWorkspace),
    ).toBeInTheDocument();
    expect(screen.getByTestId("lit-modal-search")).toBeDisabled();
  });
});
