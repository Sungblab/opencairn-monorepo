import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarEmptyState } from "./sidebar-empty-state";

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

function renderEmptyState() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SidebarEmptyState />
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("SidebarEmptyState", () => {
  beforeEach(() => {
    push.mockClear();
    (global.fetch as unknown) = undefined;
  });

  it("renders a create-project CTA when the workspace has no projects", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "ws-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      }) as unknown as typeof fetch;

    renderEmptyState();
    expect(
      await screen.findByText("sidebar.project.empty"),
    ).toBeInTheDocument();
    const cta = screen.getByRole("button", {
      name: "sidebar.project.create_cta",
    });
    expect(cta).toHaveClass("min-h-8");
    fireEvent.click(cta);
    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/new-project");
  });

  it("keeps the loading state while the workspace lookup is pending", async () => {
    const workspace = deferred<Response>();
    global.fetch = vi.fn().mockReturnValueOnce(workspace.promise) as unknown as
      typeof fetch;

    renderEmptyState();
    expect(screen.getByText("sidebar.project.loading")).toBeInTheDocument();
    expect(screen.queryByText("sidebar.project.empty")).not.toBeInTheDocument();

    workspace.resolve({
      ok: true,
      json: async () => ({ id: "ws-1" }),
    } as Response);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    }) as unknown as typeof fetch;

    expect(
      await screen.findByText("sidebar.project.empty"),
    ).toBeInTheDocument();
  });

  it("lists existing projects on workspace-level routes", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "ws-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "p-1", name: "Roadmap" }],
      }) as unknown as typeof fetch;

    renderEmptyState();
    const project = await screen.findByRole("button", { name: "Roadmap" });
    expect(project).toHaveClass("min-h-10");
    fireEvent.click(project);
    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/project/p-1");
  });
});
