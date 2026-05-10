import { describe, expect, it, vi } from "vitest";
import { handleAgentWorkbenchIntent } from "./agent-workbench-intents";

describe("handleAgentWorkbenchIntent", () => {
  it("runs a queued command intent and consumes it", () => {
    const onRun = vi.fn();
    const consume = vi.fn();

    handleAgentWorkbenchIntent({
      intent: {
        id: "intent-1",
        kind: "runCommand",
        commandId: "research",
      },
      onRun,
      consume,
    });

    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: "research" }));
    expect(consume).toHaveBeenCalledWith("intent-1");
  });

  it("applies context-only intents without running a prompt", () => {
    const onRun = vi.fn();
    const onContext = vi.fn();
    const consume = vi.fn();

    handleAgentWorkbenchIntent({
      intent: {
        id: "intent-ctx",
        kind: "applyContext",
        commandId: "current_document_only",
      },
      onRun,
      onContext,
      consume,
    });

    expect(onRun).not.toHaveBeenCalled();
    expect(onContext).toHaveBeenCalledWith(
      expect.objectContaining({ id: "current_document_only" }),
    );
    expect(consume).toHaveBeenCalledWith("intent-ctx");
  });

  it("consumes stale intents even when the command is no longer registered", () => {
    const onRun = vi.fn();
    const consume = vi.fn();

    handleAgentWorkbenchIntent({
      intent: {
        id: "intent-2",
        kind: "runCommand",
        commandId: "missing",
      } as never,
      onRun,
      consume,
    });

    expect(onRun).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledWith("intent-2");
  });
});
