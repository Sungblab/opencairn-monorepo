import { describe, expect, it } from "vitest";
import {
  AgentActionError,
  canTransition,
  createAgentAction,
  executeAgentAction,
  transitionAgentActionStatus,
  type AgentActionRepository,
  type NoteActionExecutor,
} from "./agent-actions";
import type { AgentAction } from "@opencairn/shared";

const userId = "user-1";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const actionId = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";

describe("agent action service", () => {
  it("creates a completed low-risk placeholder action with server-injected scope", async () => {
    const repo = createMemoryRepo();

    const { action, idempotent } = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "workflow.placeholder",
        risk: "low",
        input: { label: "smoke" },
      },
      { repo, canWriteProject: async () => true },
    );

    expect(idempotent).toBe(false);
    expect(action).toMatchObject({
      requestId,
      workspaceId,
      projectId,
      actorUserId: userId,
      kind: "workflow.placeholder",
      status: "completed",
      risk: "low",
      input: { label: "smoke" },
      result: { ok: true, placeholder: true, input: { label: "smoke" } },
    });
  });

  it("returns an existing row for the same requestId", async () => {
    const repo = createMemoryRepo();

    const first = await createAgentAction(
      projectId,
      userId,
      { requestId, kind: "workflow.placeholder", risk: "low" },
      { repo, canWriteProject: async () => true },
    );
    const second = await createAgentAction(
      projectId,
      userId,
      { requestId, kind: "workflow.placeholder", risk: "low", input: { ignored: true } },
      { repo, canWriteProject: async () => true },
    );

    expect(second.idempotent).toBe(true);
    expect(second.action).toEqual(first.action);
  });

  it("rejects unauthorized project actions before insertion", async () => {
    await expect(
      createAgentAction(
        projectId,
        userId,
        { requestId, kind: "workflow.placeholder", risk: "low" },
        { repo: createMemoryRepo(), canWriteProject: async () => false },
      ),
    ).rejects.toMatchObject(new AgentActionError("forbidden", 403));
  });

  it("enforces status transitions", async () => {
    expect(canTransition("draft", "queued")).toBe(true);
    expect(canTransition("completed", "running")).toBe(false);

    const repo = createMemoryRepo();
    const { action } = await createAgentAction(
      projectId,
      userId,
      { requestId, kind: "file.create", risk: "write" },
      { repo, canWriteProject: async () => true },
    );
    expect(action.status).toBe("approval_required");

    const queued = await transitionAgentActionStatus(
      action.id,
      userId,
      { status: "queued", preview: { summary: "ready" } },
      { repo, canWriteProject: async () => true },
    );
    expect(queued.status).toBe("queued");
    expect(queued.preview).toEqual({ summary: "ready" });

    await expect(
      transitionAgentActionStatus(
        action.id,
        userId,
        { status: "reverted" },
        { repo, canWriteProject: async () => true },
      ),
    ).rejects.toMatchObject(new AgentActionError("invalid_status_transition", 409));
  });

  it("executes a note.create action once and stores the completed result", async () => {
    const repo = createMemoryRepo();
    const noteExecutor = createMemoryNoteExecutor();

    const first = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "note.create",
        risk: "write",
        input: { title: "Agent brief", folderId: null },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );
    const second = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "note.create",
        risk: "write",
        input: { title: "Agent brief", folderId: null },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(noteExecutor.createdNoteIds).toEqual(["00000000-0000-4000-8000-000000000090"]);
    expect(second.action).toMatchObject({
      status: "completed",
      result: {
        ok: true,
        note: {
          id: "00000000-0000-4000-8000-000000000090",
          projectId,
          folderId: null,
          title: "Agent brief",
        },
      },
      errorCode: null,
    });
  });

  it("marks note action execution failures on the ledger", async () => {
    const repo = createMemoryRepo();
    const noteExecutor = createMemoryNoteExecutor({
      failWith: new AgentActionError("note_not_found", 404),
    });

    const { action } = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "note.rename",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          title: "Renamed brief",
        },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );

    expect(action.status).toBe("failed");
    expect(action.errorCode).toBe("note_not_found");
    expect(action.result).toEqual({ ok: false, errorCode: "note_not_found" });
  });

  it("executes Phase 2A note mutations through typed action inputs", async () => {
    const repo = createMemoryRepo();
    const noteExecutor = createMemoryNoteExecutor();

    const rename = await executeAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "note.rename",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          title: "Renamed brief",
        },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );
    expect(rename.action.status).toBe("completed");
    expect(noteExecutor.calls.map((call) => call.kind)).toEqual(["note.rename"]);

    await executeAgentAction(
      projectId,
      userId,
      {
        requestId: "00000000-0000-4000-8000-000000000005",
        kind: "note.move",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          folderId: null,
        },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );
    await executeAgentAction(
      projectId,
      userId,
      {
        requestId: "00000000-0000-4000-8000-000000000006",
        kind: "note.delete",
        risk: "destructive",
        input: { noteId: "00000000-0000-4000-8000-000000000021" },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );
    await executeAgentAction(
      projectId,
      userId,
      {
        requestId: "00000000-0000-4000-8000-000000000007",
        kind: "note.restore",
        risk: "write",
        input: { noteId: "00000000-0000-4000-8000-000000000021" },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );

    expect(noteExecutor.calls.map((call) => call.kind)).toEqual([
      "note.rename",
      "note.move",
      "note.delete",
      "note.restore",
    ]);
  });
});

function createMemoryRepo(): AgentActionRepository {
  const rows = new Map<string, AgentAction>();
  return {
    async findProjectScope(id) {
      return id === projectId ? { workspaceId } : null;
    },
    async findByRequestId(pid, actorUserId, rid) {
      return [...rows.values()].find(
        (row) => row.projectId === pid && row.actorUserId === actorUserId && row.requestId === rid,
      ) ?? null;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async listByProject({ projectId: pid, status, kind, limit }) {
      return [...rows.values()]
        .filter((row) => row.projectId === pid)
        .filter((row) => status == null || row.status === status)
        .filter((row) => kind == null || row.kind === kind)
        .slice(0, limit);
    },
    async insert(values) {
      const existing = await this.findByRequestId(
        values.projectId,
        values.actorUserId,
        values.requestId,
      );
      if (existing) return { action: existing, inserted: false };
      const now = new Date("2026-05-05T00:00:00.000Z").toISOString();
      const row: AgentAction = {
        id: rows.size === 0 ? actionId : `00000000-0000-4000-8000-${String(rows.size + 3).padStart(12, "0")}`,
        requestId: values.requestId,
        workspaceId: values.workspaceId,
        projectId: values.projectId,
        actorUserId: values.actorUserId,
        sourceRunId: values.sourceRunId ?? null,
        kind: values.kind,
        status: values.status,
        risk: values.risk,
        input: values.input,
        preview: values.preview ?? null,
        result: values.result ?? null,
        errorCode: values.errorCode ?? null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      return { action: row, inserted: true };
    },
    async updateStatus(id, values) {
      const current = rows.get(id);
      if (!current) return null;
      const next = {
        ...current,
        status: values.status,
        ...(values.preview !== undefined ? { preview: values.preview } : {}),
        ...(values.result !== undefined ? { result: values.result } : {}),
        ...(values.errorCode !== undefined ? { errorCode: values.errorCode } : {}),
        updatedAt: new Date("2026-05-05T00:01:00.000Z").toISOString(),
      };
      rows.set(id, next);
      return next;
    },
  };
}

function createMemoryNoteExecutor(options?: {
  failWith?: AgentActionError;
}): NoteActionExecutor & {
  calls: Array<{ kind: string }>;
  createdNoteIds: string[];
} {
  const calls: Array<{ kind: string }> = [];
  const createdNoteIds: string[] = [];
  return {
    calls,
    createdNoteIds,
    async execute(input) {
      calls.push({ kind: input.kind });
      if (options?.failWith) throw options.failWith;
      if (input.kind === "note.create") {
        const payload = input.payload as { title: string; folderId: string | null };
        const id = "00000000-0000-4000-8000-000000000090";
        createdNoteIds.push(id);
        return {
          ok: true,
          note: {
            id,
            projectId: input.projectId,
            folderId: payload.folderId ?? null,
            title: payload.title,
          },
        };
      }
      const payload = input.payload as {
        noteId: string;
        folderId?: string | null;
        title?: string;
      };
      return {
        ok: true,
        note: {
          id: payload.noteId,
          projectId: input.projectId,
          folderId: payload.folderId ?? null,
          title: payload.title ?? "test",
        },
      };
    },
  };
}
