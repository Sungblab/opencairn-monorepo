import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
  useFormatter: () => ({
    relativeTime: (d: Date) => d.toISOString(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <a className={className}>{children}</a>,
}));

const notes = vi.fn();
vi.mock("@/lib/api-client", () => ({
  projectsApi: {
    notes: (...args: unknown[]) => notes(...args),
  },
}));

import { ProjectNotesTable } from "./project-notes-table";

function renderWith(qc: QueryClient, onLoaded?: (rows: unknown[]) => void) {
  return render(
    <QueryClientProvider client={qc}>
      <ProjectNotesTable
        wsSlug="acme"
        projectId="project-1"
        onLoaded={onLoaded as (rows: unknown[]) => void}
      />
    </QueryClientProvider>,
  );
}

describe("ProjectNotesTable onLoaded", () => {
  it("fires onLoaded when the query resolves", async () => {
    notes.mockResolvedValue({ notes: [{ id: "n1", title: "T", kind: "manual", updated_at: new Date().toISOString() }] });
    const onLoaded = vi.fn();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWith(qc, onLoaded);
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1));
    expect(onLoaded.mock.calls[0][0]).toHaveLength(1);
  });

  it("fires onLoaded from cached data even when the network refetch is still pending", async () => {
    // Regression: the prior implementation called onLoaded inside queryFn, so
    // on a remount with hot cache the parent meta row was stale until the
    // background refetch resolved. With useEffect-on-data the side effect
    // fires from the cached payload on first paint — verify by hanging the
    // network call indefinitely.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const cached = [
      { id: "n1", title: "Cached", kind: "manual", updated_at: new Date().toISOString() },
      { id: "n2", title: "Cached2", kind: "imported", updated_at: new Date().toISOString() },
    ];
    qc.setQueryData(["project-notes", "project-1", "all"], cached);
    notes.mockReturnValue(new Promise(() => {})); // never resolves

    const onLoaded = vi.fn();
    renderWith(qc, onLoaded);
    await waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(onLoaded.mock.calls[0][0]).toEqual(cached);
  });

  it("renders filter chips as full-height controls", async () => {
    notes.mockResolvedValue({ notes: [] });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWith(qc);

    const all = await screen.findByRole("button", {
      name: "project.tabs.all",
    });
    expect(all.className).toContain("min-h-7");
  });

  it("renders note links as full-height row controls", async () => {
    notes.mockResolvedValue({
      notes: [
        {
          id: "n1",
          title: "Welcome",
          kind: "manual",
          updated_at: new Date().toISOString(),
        },
      ],
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWith(qc);

    const link = await screen.findByText("Welcome");
    expect(link.className).toContain("min-h-7");
  });
});
