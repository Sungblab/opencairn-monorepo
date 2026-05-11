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

  it("queues document generation presets separately from chat commands", () => {
    useAgentWorkbenchStore
      .getState()
      .requestDocumentGenerationPreset("pdf_report_latex");

    expect(
      useAgentWorkbenchStore.getState().pendingDocumentGenerationPreset,
    ).toMatchObject({
      presetId: "pdf_report_latex",
    });
    expect(useAgentWorkbenchStore.getState().pendingIntent).toBeNull();
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

  it("does not let an old preset consumer clear a newer preset", () => {
    useAgentWorkbenchStore
      .getState()
      .requestDocumentGenerationPreset("pdf_report_fast");
    const first = useAgentWorkbenchStore.getState().pendingDocumentGenerationPreset;
    useAgentWorkbenchStore
      .getState()
      .requestDocumentGenerationPreset("pptx_deck");

    useAgentWorkbenchStore
      .getState()
      .consumeDocumentGenerationPreset(first?.id ?? "");

    expect(
      useAgentWorkbenchStore.getState().pendingDocumentGenerationPreset,
    ).toMatchObject({
      presetId: "pptx_deck",
    });
  });
});
