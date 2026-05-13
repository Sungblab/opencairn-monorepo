import { describe, expect, it } from "vitest";
import {
  createAgentActionRequestSchema,
  interactionChoiceRespondRequestSchema,
  noteUpdateApplyRequestSchema,
  noteUpdateApplyResultSchema,
  noteUpdatePreviewSchema,
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

  it("accepts an interaction.choice action request and response", () => {
    const parsed = createAgentActionRequestSchema.parse({
      requestId: "00000000-0000-4000-8000-000000000001",
      kind: "interaction.choice",
      risk: "low",
      approvalMode: "auto_safe",
      input: {
        cardId: "format",
        prompt: "어떤 형태로 만들까요?",
        options: [
          {
            id: "summary",
            label: "요약 노트",
            value: "요약 노트로 만들어줘",
          },
        ],
        allowCustom: true,
        source: {},
      },
    });

    expect(parsed.kind).toBe("interaction.choice");
    expect(
      interactionChoiceRespondRequestSchema.parse({
        optionId: "summary",
        value: "요약 노트로 만들어줘",
        label: "요약 노트",
      }),
    ).toMatchObject({ optionId: "summary" });
  });

  it("rejects scoped interaction.choice followup payloads", () => {
    const parsed = createAgentActionRequestSchema.safeParse({
      kind: "interaction.choice",
      risk: "low",
      input: {
        cardId: "format",
        prompt: "어떤 형태로 만들까요?",
        options: [
          {
            id: "summary",
            label: "요약 노트",
            value: "요약 노트로 만들어줘",
            followup: {
              kind: "note.create",
              risk: "write",
              input: { title: "Forged", projectId: "00000000-0000-4000-8000-000000000099" },
            },
          },
        ],
      },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      "scope_fields_are_server_injected",
    );
  });

  it("accepts an explicit ask-before-action approval mode", () => {
    const parsed = createAgentActionRequestSchema.parse({
      requestId: "00000000-0000-4000-8000-000000000010",
      kind: "note.create",
      risk: "write",
      approvalMode: "require",
      input: { title: "Project brief", folderId: null },
    });

    expect(parsed.approvalMode).toBe("require");
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

  it("requires external approval risk for dependency install actions", () => {
    expect(
      createAgentActionRequestSchema.parse({
        kind: "code_project.install",
        risk: "external",
        input: {
          codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
          snapshotId: "00000000-0000-4000-8000-000000000101",
          packages: [{ name: "zod" }],
          network: "required",
        },
      }).risk,
    ).toBe("external");

    const parsed = createAgentActionRequestSchema.safeParse({
      kind: "code_project.install",
      risk: "write",
      input: {
        codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
        snapshotId: "00000000-0000-4000-8000-000000000101",
        packages: [{ name: "zod" }],
        network: "required",
      },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      "dependency_installs_must_require_external_approval",
    );
  });

  it("requires external approval risk for hosted preview actions", () => {
    expect(
      createAgentActionRequestSchema.parse({
        kind: "code_project.preview",
        risk: "external",
        input: {
          codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
          snapshotId: "00000000-0000-4000-8000-000000000101",
          mode: "static",
          entryPath: "index.html",
        },
      }).risk,
    ).toBe("external");

    const parsed = createAgentActionRequestSchema.safeParse({
      kind: "code_project.preview",
      risk: "write",
      input: {
        codeWorkspaceId: "00000000-0000-4000-8000-000000000203",
        snapshotId: "00000000-0000-4000-8000-000000000101",
        mode: "static",
      },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      "hosted_previews_must_require_external_approval",
    );
  });

  it("accepts the Phase 2A note action input contracts", () => {
    expect(
      createAgentActionRequestSchema.parse({
        kind: "note.create",
        risk: "write",
        input: { title: "Agent brief", folderId: null },
      }).input,
    ).toEqual({ title: "Agent brief", folderId: null });

    expect(
      createAgentActionRequestSchema.parse({
        kind: "note.create_from_markdown",
        risk: "write",
        input: {
          title: "Agent brief",
          folderId: null,
          bodyMarkdown: "# Agent brief\n\n[[Related page]]",
        },
      }).input,
    ).toEqual({
      title: "Agent brief",
      folderId: null,
      bodyMarkdown: "# Agent brief\n\n[[Related page]]",
    });

    expect(
      createAgentActionRequestSchema.parse({
        kind: "note.rename",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          title: "Renamed brief",
        },
      }).input,
    ).toEqual({
      noteId: "00000000-0000-4000-8000-000000000021",
      title: "Renamed brief",
    });

    expect(
      createAgentActionRequestSchema.parse({
        kind: "note.move",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          folderId: "00000000-0000-4000-8000-000000000022",
        },
      }).input,
    ).toEqual({
      noteId: "00000000-0000-4000-8000-000000000021",
      folderId: "00000000-0000-4000-8000-000000000022",
    });

    expect(
      createAgentActionRequestSchema.parse({
        kind: "note.delete",
        risk: "destructive",
        input: { noteId: "00000000-0000-4000-8000-000000000021" },
      }).input,
    ).toEqual({ noteId: "00000000-0000-4000-8000-000000000021" });

    expect(
      createAgentActionRequestSchema.parse({
        kind: "note.restore",
        risk: "write",
        input: { noteId: "00000000-0000-4000-8000-000000000021" },
      }).input,
    ).toEqual({ noteId: "00000000-0000-4000-8000-000000000021" });
  });

  it("accepts the Phase 2B note.update draft input and preview contract", () => {
    const input = createAgentActionRequestSchema.parse({
      kind: "note.update",
      risk: "write",
      input: {
        noteId: "00000000-0000-4000-8000-000000000021",
        draft: {
          format: "plate_value_v1",
          content: [{ type: "p", children: [{ text: "updated draft" }] }],
        },
        reason: "tighten intro",
      },
    }).input;

    expect(input).toEqual({
      noteId: "00000000-0000-4000-8000-000000000021",
      draft: {
        format: "plate_value_v1",
        content: [{ type: "p", children: [{ text: "updated draft" }] }],
      },
      reason: "tighten intro",
    });

    expect(
      noteUpdatePreviewSchema.parse({
        noteId: "00000000-0000-4000-8000-000000000021",
        source: "yjs",
        current: {
          contentText: "old draft",
          yjsStateVectorBase64: "AQID",
        },
        draft: {
          contentText: "updated draft",
        },
        diff: {
          fromVersion: "current",
          toVersion: "current",
          summary: {
            addedBlocks: 0,
            removedBlocks: 0,
            changedBlocks: 1,
            addedWords: 1,
            removedWords: 1,
          },
          blocks: [
            {
              key: "0",
              status: "changed",
              textDiff: [
                { kind: "delete", text: "old" },
                { kind: "insert", text: "updated" },
                { kind: "equal", text: " draft" },
              ],
            },
          ],
        },
        applyConstraints: [
          "apply_must_transform_yjs_document",
          "capture_version_before_apply",
        ],
      }),
    ).toMatchObject({
      noteId: "00000000-0000-4000-8000-000000000021",
      source: "yjs",
      current: { contentText: "old draft" },
      draft: { contentText: "updated draft" },
    });
  });

  it("caps note.update draft blocks to protect API and database work", () => {
    const parsed = createAgentActionRequestSchema.safeParse({
      kind: "note.update",
      risk: "write",
      input: {
        noteId: "00000000-0000-4000-8000-000000000021",
        draft: {
          format: "plate_value_v1",
          content: Array.from({ length: 1001 }, () => ({
            type: "p",
            children: [{ text: "block" }],
          })),
        },
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts the Phase 2B note.update apply request and result contracts", () => {
    expect(
      noteUpdateApplyRequestSchema.parse({
        yjsStateVectorBase64: "AQID",
      }),
    ).toEqual({
      yjsStateVectorBase64: "AQID",
    });

    expect(
      noteUpdateApplyResultSchema.parse({
        ok: true,
        noteId: "00000000-0000-4000-8000-000000000021",
        applied: {
          source: "yjs",
          yjsStateVectorBase64: "BAUG",
          contentText: "updated draft",
        },
        versionCapture: {
          before: { created: true, version: 4 },
          after: { created: true, version: 5 },
        },
        summary: {
          changedBlocks: 1,
          addedWords: 2,
          removedWords: 1,
        },
      }),
    ).toMatchObject({
      ok: true,
      noteId: "00000000-0000-4000-8000-000000000021",
      applied: {
        source: "yjs",
        contentText: "updated draft",
      },
    });
  });

  it("rejects non-note input shapes", () => {
    expect(
      createAgentActionRequestSchema.safeParse({
        kind: "note.rename",
        risk: "write",
        input: { noteId: "00000000-0000-4000-8000-000000000021" },
      }).success,
    ).toBe(false);

    expect(
      createAgentActionRequestSchema.safeParse({
        kind: "note.create",
        risk: "write",
        input: {
          title: "Scoped",
          projectId: "00000000-0000-4000-8000-000000000099",
        },
      }).success,
    ).toBe(false);
  });

  it("accepts typed project-file action inputs", () => {
    expect(
      createAgentActionRequestSchema.parse({
        kind: "file.create",
        risk: "write",
        input: {
          filename: "brief.md",
          title: "Brief",
          content: "# Brief",
        },
      }).input,
    ).toEqual({
      filename: "brief.md",
      title: "Brief",
      content: "# Brief",
    });

    expect(
      createAgentActionRequestSchema.parse({
        kind: "file.update",
        risk: "write",
        input: {
          fileId: "00000000-0000-4000-8000-000000000090",
          filename: "brief-v2.md",
          content: "# Brief v2",
        },
      }).input,
    ).toEqual({
      fileId: "00000000-0000-4000-8000-000000000090",
      filename: "brief-v2.md",
      content: "# Brief v2",
    });

    expect(
      createAgentActionRequestSchema.parse({
        kind: "file.delete",
        risk: "destructive",
        input: { fileId: "00000000-0000-4000-8000-000000000090" },
      }).input,
    ).toEqual({ fileId: "00000000-0000-4000-8000-000000000090" });
  });

  it("rejects invalid project-file action inputs", () => {
    expect(
      createAgentActionRequestSchema.safeParse({
        kind: "file.create",
        risk: "write",
        input: {
          filename: "../brief.md",
          content: "# Brief",
        },
      }).success,
    ).toBe(false);

    expect(
      createAgentActionRequestSchema.safeParse({
        kind: "file.update",
        risk: "write",
        input: {
          fileId: "00000000-0000-4000-8000-000000000090",
        },
      }).success,
    ).toBe(false);

    const ingestOnly = createAgentActionRequestSchema.safeParse({
      kind: "file.update",
      risk: "write",
      input: {
        fileId: "00000000-0000-4000-8000-000000000090",
        startIngest: true,
      },
    });
    expect(ingestOnly.success).toBe(false);
    expect(ingestOnly.error?.issues.map((issue) => issue.message)).toContain(
      "start_ingest_requires_new_content",
    );
  });
});
