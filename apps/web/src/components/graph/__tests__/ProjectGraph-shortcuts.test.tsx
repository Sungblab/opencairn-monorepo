import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ProjectGraph } from "../ProjectGraph";
import koGraph from "@/../messages/ko/graph.json";
import { useRouter, useSearchParams } from "next/navigation";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({
  projectsApi: {
    wikiIndex: vi.fn(async () => ({
      projectId: "p-1",
      generatedAt: "2026-05-13T01:00:00.000Z",
      latestPageUpdatedAt: null,
      totals: { pages: 0, wikiLinks: 0, orphanPages: 0 },
      health: { status: "healthy", issues: [] },
      links: [],
      unresolvedLinks: [],
      recentLogs: [],
      pages: [],
    })),
    permissions: vi.fn(async () => ({ role: "viewer", overrides: {} })),
    refreshWikiIndex: vi.fn(),
  },
  plan8AgentsApi: {
    runLibrarian: vi.fn(),
  },
}));
vi.mock("../ViewRenderer", () => ({ ViewRenderer: () => <div /> }));
vi.mock("../ai/VisualizeDialog", () => ({ VisualizeDialog: () => null }));
vi.mock("../ViewSwitcher", () => ({ ViewSwitcher: () => <div /> }));

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ProjectGraph keyboard shortcuts", () => {
  let replace: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    replace = vi.fn();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ replace });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams(),
    );
  });

  it("pressing 2 switches to mindmap when no input is focused", () => {
    wrap(<ProjectGraph projectId="p-1" />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    const url = replace.mock.calls[0]?.[0] as string | undefined;
    expect(url).toContain("view=mindmap");
  });

  it("pressing 3 switches to cards", () => {
    wrap(<ProjectGraph projectId="p-1" />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "3" }));
    expect(replace.mock.calls[0]?.[0] as string).toContain("view=cards");
  });

  it("ignores number keys when an input is focused", () => {
    const { container } = wrap(<ProjectGraph projectId="p-1" />);
    const input = document.createElement("input");
    container.appendChild(input);
    input.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
    expect(replace).not.toHaveBeenCalled();
  });
});
