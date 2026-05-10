import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koSidebar from "@/../messages/ko/sidebar.json";
import { ProjectGraphLink } from "./project-graph-link";

const mocks = vi.hoisted(() => ({
  projectId: { current: "p-1" as string | null },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "w-slug" }),
}));

vi.mock("./use-current-project", () => ({
  useCurrentProjectContext: () => ({ projectId: mocks.projectId.current, wsSlug: "w-slug" }),
}));

beforeEach(() => {
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

  it("uses a plain link for browser-owned navigation", () => {
    wrap(<ProjectGraphLink />);
    const link = screen.getByRole("link", { name: koSidebar.graph.entry });
    expect(link.tagName).toBe("A");
    expect(link).not.toHaveAttribute("role", "button");
  });
});
