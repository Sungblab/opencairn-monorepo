import { beforeEach, describe, expect, it } from "vitest";
import { useAgentWorkbenchStore } from "./agent-workbench-store";

describe("agent-workbench-store", () => {
  beforeEach(() => {
    useAgentWorkbenchStore.setState(useAgentWorkbenchStore.getInitialState(), true);
  });

  it("queues command intents with a stable command id", () => {
    useAgentWorkbenchStore.getState().requestCommand("research");

    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "runCommand",
      commandId: "research",
    });
  });

  it("queues context intents separately from sendable command intents", () => {
    useAgentWorkbenchStore.getState().requestContext("current_document_only");

    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "applyContext",
      commandId: "current_document_only",
    });
  });

  it("does not let an old consumer clear a newer intent", () => {
    useAgentWorkbenchStore.getState().requestCommand("research");
    const first = useAgentWorkbenchStore.getState().pendingIntent;
    useAgentWorkbenchStore.getState().requestCommand("generate_report");

    useAgentWorkbenchStore.getState().consumeIntent(first?.id ?? "");

    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "runCommand",
      commandId: "generate_report",
    });
  });

  it("clears the currently pending intent by id", () => {
    useAgentWorkbenchStore.getState().requestCommand("summarize");
    const intent = useAgentWorkbenchStore.getState().pendingIntent;

    useAgentWorkbenchStore.getState().consumeIntent(intent?.id ?? "");

    expect(useAgentWorkbenchStore.getState().pendingIntent).toBeNull();
  });
});
