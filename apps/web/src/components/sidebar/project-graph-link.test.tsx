import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koSidebar from "@/../messages/ko/sidebar.json";
import { ProjectGraphLink } from "./project-graph-link";

const mocks = vi.hoisted(() => ({
  assign: vi.fn(),
  projectId: { current: "p-1" as string | null },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "w-slug" }),
}));

vi.mock("./use-current-project", () => ({
  useCurrentProjectContext: () => ({ projectId: mocks.projectId.current, wsSlug: "w-slug" }),
}));

beforeEach(() => {
  mocks.assign.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: mocks.assign },
  });
  mocks.projectId.current = "p-1";
});

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ sidebar: koSidebar }}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("ProjectGraphLink", () => {
  it("renders nothing when no project is selected", () => {
    mocks.projectId.current = null;
    const { container } = wrap(<ProjectGraphLink />);
    expect(container.firstChild).toBeNull();
  });

  it("links to the project graph route", () => {
    wrap(<ProjectGraphLink />);
    const link = screen.getByRole("link", { name: koSidebar.graph.entry });
    expect(link).toHaveAttribute(
      "href",
      "/ko/workspace/w-slug/project/p-1/graph",
    );
  });

  it("navigates to the graph route on click", () => {
    wrap(<ProjectGraphLink />);
    screen.getByRole("link", { name: koSidebar.graph.entry }).click();
    expect(mocks.assign).toHaveBeenCalledWith(
      "/ko/workspace/w-slug/project/p-1/graph",
    );
  });
});
