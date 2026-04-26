import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useSearchParams } from "next/navigation";
import { ViewRenderer } from "../ViewRenderer";

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
}));

// next/dynamic: passthrough to the underlying loader so vi.mock'd modules
// resolve to the stub components below instead of the real implementations.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<unknown> }>) => {
    const Lazy = (props: Record<string, unknown>) => {
      const [Comp, setComp] = (require("react") as typeof import("react")).useState<
        React.ComponentType<unknown> | null
      >(null);
      (require("react") as typeof import("react")).useEffect(() => {
        loader().then((m) => setComp(() => m.default));
      }, []);
      if (!Comp) return null;
      return <Comp {...props} />;
    };
    return Lazy;
  },
}));

vi.mock("../views/GraphView", () => ({
  default: () => <div data-testid="graph-view" />,
}));
vi.mock("../views/MindmapView", () => ({
  default: () => <div data-testid="mindmap-view" />,
}));
vi.mock("../views/BoardView", () => ({
  default: () => <div data-testid="board-view" />,
}));
vi.mock("../views/CardsView", () => ({
  default: () => <div data-testid="cards-view" />,
}));
vi.mock("../views/TimelineView", () => ({
  default: () => <div data-testid="timeline-view" />,
}));

function setSearch(query: string) {
  (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    new URLSearchParams(query),
  );
}

describe("ViewRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders GraphView when ?view is missing", async () => {
    setSearch("");
    render(<ViewRenderer projectId="p1" />);
    expect(await screen.findByTestId("graph-view")).toBeInTheDocument();
  });

  it("renders GraphView for ?view=graph", async () => {
    setSearch("view=graph");
    render(<ViewRenderer projectId="p1" />);
    expect(await screen.findByTestId("graph-view")).toBeInTheDocument();
  });

  it("renders MindmapView for ?view=mindmap", async () => {
    setSearch("view=mindmap");
    render(<ViewRenderer projectId="p1" />);
    expect(await screen.findByTestId("mindmap-view")).toBeInTheDocument();
  });

  it("renders BoardView for ?view=board", async () => {
    setSearch("view=board");
    render(<ViewRenderer projectId="p1" />);
    expect(await screen.findByTestId("board-view")).toBeInTheDocument();
  });

  it("renders CardsView for ?view=cards", async () => {
    setSearch("view=cards");
    render(<ViewRenderer projectId="p1" />);
    expect(await screen.findByTestId("cards-view")).toBeInTheDocument();
  });

  it("renders TimelineView for ?view=timeline", async () => {
    setSearch("view=timeline");
    render(<ViewRenderer projectId="p1" />);
    expect(await screen.findByTestId("timeline-view")).toBeInTheDocument();
  });

  it("falls back to GraphView for unknown ?view value", async () => {
    setSearch("view=bogus");
    render(<ViewRenderer projectId="p1" />);
    expect(await screen.findByTestId("graph-view")).toBeInTheDocument();
  });
});
