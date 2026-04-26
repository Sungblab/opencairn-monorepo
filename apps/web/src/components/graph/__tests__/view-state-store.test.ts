import { describe, it, expect, beforeEach } from "vitest";
import { useViewStateStore } from "../view-state-store";
import type { ViewSpec } from "@opencairn/shared";

const sampleSpec: ViewSpec = {
  viewType: "mindmap",
  layout: "dagre",
  rootId: "11111111-1111-4111-8111-111111111111",
  nodes: [{ id: "11111111-1111-4111-8111-111111111111", name: "Root" }],
  edges: [],
};

describe("useViewStateStore", () => {
  beforeEach(() => {
    useViewStateStore.setState({ inline: {} });
  });

  it("setInline stores ViewSpec keyed by projectId+viewType+rootId", () => {
    useViewStateStore.getState().setInline("proj-1", sampleSpec);
    const got = useViewStateStore.getState().getInline(
      "proj-1", "mindmap", sampleSpec.rootId,
    );
    expect(got).toEqual(sampleSpec);
  });

  it("getInline returns null when no entry", () => {
    expect(
      useViewStateStore.getState().getInline("proj-1", "graph", null),
    ).toBeNull();
  });

  it("setInline overwrites prior entry for same key", () => {
    useViewStateStore.getState().setInline("proj-1", sampleSpec);
    const updated = { ...sampleSpec, rationale: "new" };
    useViewStateStore.getState().setInline("proj-1", updated);
    const got = useViewStateStore.getState().getInline(
      "proj-1", "mindmap", sampleSpec.rootId,
    );
    expect(got?.rationale).toBe("new");
  });

  it("clearProject removes only that project's entries", () => {
    useViewStateStore.getState().setInline("proj-1", sampleSpec);
    useViewStateStore.getState().setInline("proj-2", sampleSpec);
    useViewStateStore.getState().clearProject("proj-1");
    expect(
      useViewStateStore.getState().getInline(
        "proj-1", "mindmap", sampleSpec.rootId,
      ),
    ).toBeNull();
    expect(
      useViewStateStore.getState().getInline(
        "proj-2", "mindmap", sampleSpec.rootId,
      ),
    ).toEqual(sampleSpec);
  });
});
