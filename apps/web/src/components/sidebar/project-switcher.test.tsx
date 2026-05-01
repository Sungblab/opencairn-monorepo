import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSwitcher } from "./project-switcher";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ wsSlug: "acme" }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

function mockFetch(handlers: Record<string, unknown>) {
  global.fetch = vi.fn().mockImplementation(async (input: RequestInfo) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [prefix, body] of Object.entries(handlers)) {
      if (url.includes(prefix)) {
        return {
          ok: true,
          json: async () => body,
        } as unknown as Response;
      }
    }
    return { ok: false, status: 404 } as Response;
  }) as unknown as typeof fetch;
}

function renderSwitcher() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectSwitcher />
    </QueryClientProvider>,
  );
}

describe("ProjectSwitcher", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("resolves wsSlug to id and lists projects under that workspace", async () => {
    mockFetch({
      "by-slug/acme": { id: "ws-1", slug: "acme", name: "ACME" },
      "/workspaces/ws-1/projects": [
        { id: "p-1", name: "Roadmap" },
        { id: "p-2", name: "Research" },
      ],
    });

    renderSwitcher();
    expect(await screen.findByText("Roadmap")).toBeInTheDocument();
    expect(screen.getByText("Research")).toBeInTheDocument();
  });

  it("navigates to the selected project using the current locale", async () => {
    mockFetch({
      "by-slug/acme": { id: "ws-1", slug: "acme", name: "ACME" },
      "/workspaces/ws-1/projects": [{ id: "p-1", name: "Roadmap" }],
    });

    renderSwitcher();
    // The listbox uses `role=option` with `aria-label="sidebar.project.switch_aria"`
    // on its container; rows are matched by visible text.
    const btn = await screen.findByText("Roadmap");
    fireEvent.click(btn);
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/ko/workspace/acme/project/p-1");
    });
  });

  it("always exposes a new-project entry", async () => {
    mockFetch({
      "by-slug/acme": { id: "ws-1", slug: "acme", name: "ACME" },
      "/workspaces/ws-1/projects": [],
    });

    renderSwitcher();
    // `+ {t("new")}` — mock returns namespace-prefixed key so the button text
    // ends up as "+ sidebar.project.new".
    const newBtn = await screen.findByText(/sidebar\.project\.new/);
    fireEvent.click(newBtn);
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/ko/workspace/acme/new-project");
    });
  });
});
