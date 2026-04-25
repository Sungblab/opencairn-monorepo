import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import koNote from "@/../messages/ko/note.json";
import { BacklinksPanel } from "./BacklinksPanel";

const replacePreview = vi.fn();
vi.mock("@/stores/tabs-store", () => ({
  useTabsStore: (selector: (s: unknown) => unknown) =>
    selector({ addOrReplacePreview: replacePreview }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ wsSlug: "w" }),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ note: koNote }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BacklinksPanel", () => {
  it("renders empty state when there are no backlinks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 })),
    );
    wrap(<BacklinksPanel noteId="n1" />);
    expect(await screen.findByText(koNote.backlinks.empty)).toBeInTheDocument();
  });

  it("opens the source note as a preview tab on row click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "src1", title: "Source A", projectId: "p", projectName: "P", updatedAt: new Date().toISOString() }],
            total: 1,
          }),
          { status: 200 },
        ),
      ),
    );
    wrap(<BacklinksPanel noteId="n1" />);
    const row = await screen.findByRole("button", { name: /Source A/ });
    fireEvent.click(row);
    await waitFor(() =>
      expect(replacePreview).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "note", mode: "plate", targetId: "src1" }),
      ),
    );
  });
});
