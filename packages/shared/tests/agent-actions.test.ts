import { describe, expect, it } from "vitest";
import {
  createAgentActionRequestSchema,
  transitionAgentActionStatusRequestSchema,
} from "../src/agent-actions";

describe("agent action schemas", () => {
  it("accepts low-risk placeholder actions without trusted scope", () => {
    const parsed = createAgentActionRequestSchema.parse({
      requestId: "00000000-0000-4000-8000-000000000010",
      kind: "workflow.placeholder",
      risk: "low",
      input: { label: "phase-1-smoke" },
    });

    expect(parsed.kind).toBe("workflow.placeholder");
    expect(parsed.input).toEqual({ label: "phase-1-smoke" });
  });

  it("rejects LLM-supplied scope fields in action input", () => {
    const parsed = createAgentActionRequestSchema.safeParse({
      kind: "workflow.placeholder",
      risk: "low",
      input: {
        workspaceId: "00000000-0000-4000-8000-000000000001",
        nested: { user_id: "user-1" },
      },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      "scope_fields_are_server_injected",
    );
  });

  it("rejects deeply nested payloads before recursion can exhaust the stack", () => {
    let value: Record<string, unknown> = {};
    const root = value;
    for (let i = 0; i < 25; i += 1) {
      value.next = {};
      value = value.next as Record<string, unknown>;
    }

    const parsed = createAgentActionRequestSchema.safeParse({
      kind: "workflow.placeholder",
      risk: "low",
      input: root,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      "payload_too_deep",
    );
  });

  it("validates status transition payloads", () => {
    expect(
      transitionAgentActionStatusRequestSchema.parse({
        status: "failed",
        errorCode: "worker_timeout",
        result: { retryable: true },
      }),
    ).toEqual({
      status: "failed",
      errorCode: "worker_timeout",
      result: { retryable: true },
    });
  });
});
