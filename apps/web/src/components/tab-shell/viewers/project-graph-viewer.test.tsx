import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import { ProjectGraphViewer } from "./project-graph-viewer";
import type { Tab } from "@/stores/tabs-store";

vi.mock("@/components/graph/ProjectGraph", () => ({
  ProjectGraph: ({ projectId }: { projectId: string }) => (
    <div data-testid="project-graph">{projectId}</div>
  ),
}));

const baseTab: Tab = {
  id: "tab-1",
  kind: "project",
  targetId: null,
  mode: "graph",
  title: "Graph",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
};

describe("ProjectGraphViewer", () => {
  it("renders missing message when targetId is null", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        <ProjectGraphViewer tab={baseTab} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(koGraph.viewer.missing)).toBeInTheDocument();
  });

  it("renders ProjectGraph with the target projectId", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        <ProjectGraphViewer tab={{ ...baseTab, targetId: "p-42" }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("project-graph")).toHaveTextContent("p-42");
  });
});
