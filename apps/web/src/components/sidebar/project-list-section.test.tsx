import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectListSection } from "./project-list-section";

const push = vi.fn();
const currentProject = vi.hoisted(() => ({
  value: { wsSlug: "acme", projectId: "p-1" as string | null },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ wsSlug: "acme" }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("./use-current-project", () => ({
  useCurrentProjectContext: () => currentProject.value,
}));

function renderProjectList() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });

  return render(
    <QueryClientProvider client={qc}>
      <ProjectListSection />
    </QueryClientProvider>,
  );
}

describe("ProjectListSection", () => {
  beforeEach(() => {
    push.mockClear();
    currentProject.value = { wsSlug: "acme", projectId: "p-1" };
    (global.fetch as unknown) = undefined;
  });

  it("lists projects and marks the current project", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "ws-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: "p-1", name: "Roadmap" },
          { id: "p-2", name: "Research" },
        ],
      }) as unknown as typeof fetch;

    renderProjectList();

    const current = await screen.findByRole("button", { name: "Roadmap" });
    expect(current).toHaveAttribute("aria-current", "page");

    const other = screen.getByRole("button", { name: "Research" });
    fireEvent.click(other);
    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/project/p-2");
  });

  it("routes the plus button to new project", async () => {
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

    renderProjectList();

    const create = screen.getByRole("button", { name: "sidebar.project.new" });
    fireEvent.click(create);
    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/new-project");
    expect(
      await screen.findByText("sidebar.project.empty"),
    ).toBeInTheDocument();
  });
});
