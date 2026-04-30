import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koSidebar from "@/../messages/ko/sidebar.json";
import { ProjectGraphLink } from "./project-graph-link";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  addTab: vi.fn(),
  projectId: { current: "p-1" as string | null },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({ wsSlug: "w-slug" }),
}));

vi.mock("@/stores/tabs-store", () => ({
  useTabsStore: (selector: (s: { addTab: typeof mocks.addTab }) => unknown) =>
    selector({ addTab: mocks.addTab }),
}));

vi.mock("./use-current-project", () => ({
  useCurrentProjectContext: () => ({ projectId: mocks.projectId.current, wsSlug: "w-slug" }),
}));

beforeEach(() => {
  mocks.push.mockReset();
  mocks.addTab.mockReset();
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

  it("opens a graph tab + pushes the URL on click", () => {
    wrap(<ProjectGraphLink />);
    fireEvent.click(screen.getByRole("button", { name: koSidebar.graph.entry }));
    expect(mocks.addTab).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "project", mode: "graph", targetId: "p-1" }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/ko/app/w/w-slug/p/p-1/graph");
  });
});
