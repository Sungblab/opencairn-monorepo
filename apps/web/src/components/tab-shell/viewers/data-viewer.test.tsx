import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { DataViewer } from "./data-viewer";

const messages = {
  appShell: { viewers: { data: { empty: "데이터 없음" } } },
};

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const tab = {
  id: "t",
  kind: "note" as const,
  targetId: "n1",
  mode: "data" as const,
  title: "T",
  titleKey: undefined,
  titleParams: undefined,
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null as "left" | "right" | null,
  scrollY: 0,
};

describe("DataViewer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the parsed JSON tree", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { answer: 42 } })),
    ) as never;
    wrap(<DataViewer tab={tab} />);
    await waitFor(() =>
      expect(screen.getByText(/answer/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("shows empty-state when data is null", async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: null })),
    ) as never;
    wrap(<DataViewer tab={tab} />);
    await waitFor(() =>
      expect(screen.getByText("데이터 없음")).toBeInTheDocument(),
    );
  });

  it("renders nothing when targetId is null", () => {
    const { container } = wrap(
      <DataViewer tab={{ ...tab, targetId: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
