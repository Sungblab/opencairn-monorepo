import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectHero } from "./project-hero";

vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "acme", projectId: "p-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

function renderHero() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectHero />
    </QueryClientProvider>,
  );
}

describe("ProjectHero", () => {
  beforeEach(() => {
    (global.fetch as unknown) = undefined;
  });

  it("shows the project name once the fetch resolves", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "p-1", name: "Roadmap", workspaceId: "ws-1" }),
    }) as unknown as typeof fetch;

    renderHero();
    await waitFor(() => {
      expect(screen.getByText("Roadmap")).toBeInTheDocument();
    });
  });

  it("falls back to an empty-state label when no project is selected", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    renderHero();
    expect(
      await screen.findByText("sidebar.project.empty"),
    ).toBeInTheDocument();
  });
});
