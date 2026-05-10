import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectHero } from "./project-hero";

let routeParams = { wsSlug: "acme", projectId: "p-1" as string | undefined };

vi.mock("next/navigation", () => ({
  useParams: () => routeParams,
  usePathname: () =>
    routeParams.projectId
      ? `/ko/workspace/${routeParams.wsSlug}/project/${routeParams.projectId}`
      : `/ko/workspace/${routeParams.wsSlug}`,
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
    routeParams = { wsSlug: "acme", projectId: "p-1" };
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

  it("uses a select-project label when no project is selected", async () => {
    routeParams = { wsSlug: "acme", projectId: undefined };
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    renderHero();
    expect(
      await screen.findByText("sidebar.project.select"),
    ).toBeInTheDocument();
  });

  it("uses the same stable placeholder while a route project is still loading", () => {
    global.fetch = vi.fn().mockResolvedValue(new Promise(() => {})) as unknown as typeof fetch;

    renderHero();

    expect(screen.getByText("sidebar.project.select")).toBeInTheDocument();
    expect(screen.queryByText("sidebar.project.empty")).not.toBeInTheDocument();
  });

  it("uses the unified sidebar control treatment for the project trigger", async () => {
    routeParams = { wsSlug: "acme", projectId: undefined };
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    renderHero();
    const trigger = await screen.findByRole("button", {
      name: "sidebar.project.switch_aria",
    });

    expect(trigger).toHaveClass(
      "min-h-10",
      "md:min-h-9",
      "rounded-[var(--radius-control)]",
      "border",
      "border-transparent",
      "bg-background",
      "md:py-1.5",
      "hover:border-border",
      "hover:bg-muted/50",
    );
  });
});
