import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectView } from "./project-view";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("@/hooks/useWorkspaceId", () => ({
  useWorkspaceId: () => "workspace-1",
}));

vi.mock("@/lib/api-client", () => ({
  projectsApi: {
    get: vi.fn(async () => ({ id: "p1", name: "Project One" })),
  },
}));

vi.mock("@/components/literature/literature-search-modal", () => ({
  LiteratureSearchModal: ({ open }: { open: boolean }) =>
    open ? <div>literature modal</div> : null,
}));

vi.mock("./project-meta-row", () => ({
  ProjectMetaRow: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("./project-notes-table", () => ({
  ProjectNotesTable: () => <div>notes table</div>,
}));

function renderProjectView() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectView wsSlug="acme" projectId="p1" />
    </QueryClientProvider>,
  );
}

describe("ProjectView", () => {
  it("surfaces project tools in the central workbench", () => {
    renderProjectView();

    expect(screen.getByText("project.tools.heading")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /project\.tools\.research\.title/ }),
    ).toHaveAttribute("href", "/ko/workspace/acme/research?project=p1");
    expect(
      screen.getByRole("link", { name: /project\.tools\.graph\.title/ }),
    ).toHaveAttribute("href", "/ko/workspace/acme/project/p1/graph");
    expect(
      screen.getByRole("link", { name: /project\.tools\.agents\.title/ }),
    ).toHaveAttribute("href", "/ko/workspace/acme/project/p1/agents");
    expect(
      screen.getByRole("link", { name: /project\.tools\.runs\.title/ }),
    ).toHaveAttribute(
      "href",
      "/ko/workspace/acme/project/p1/agents?view=runs#workflow-console",
    );
    expect(
      screen.getByRole("link", {
        name: /project\.tools\.generateDocument\.title/,
      }),
    ).toHaveAttribute("href", "/ko/workspace/acme/synthesis-export?project=p1");
    expect(
      screen.getByRole("link", { name: /project\.tools\.research\.title/ }),
    ).toHaveClass("hover:bg-muted/40");
    expect(
      screen.getByRole("button", {
        name: /project\.tools\.literature\.title/,
      }),
    ).toHaveClass("hover:bg-muted/40");
    expect(screen.getByText("notes table")).toBeInTheDocument();
  });
});
