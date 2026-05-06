import { randomUUID } from "node:crypto";
import {
  agentRuns,
  db as defaultDb,
  eq,
  notes,
  projects,
  type DB,
} from "@opencairn/db";
import { z } from "zod";
import { canRead, canWrite } from "./permissions";
import { getTemporalClient, taskQueue } from "./temporal-client";

const plan8AgentNameSchema = z.enum([
  "librarian",
  "synthesis",
  "curator",
  "connector",
  "staleness",
  "narrator",
]);

const uuidSchema = z.string().uuid();

export const plan8AgentRunInputSchema = z.discriminatedUnion("agentName", [
  z.object({
    agentName: z.literal("librarian"),
    parentRunId: uuidSchema.nullable().optional(),
  }).strict(),
  z.object({
    agentName: z.literal("synthesis"),
    noteIds: z.array(uuidSchema).min(1).max(10),
    title: z.string().trim().min(1).max(200).optional(),
    style: z.string().trim().max(100).optional(),
    parentRunId: uuidSchema.nullable().optional(),
  }).strict(),
  z.object({
    agentName: z.literal("curator"),
    maxOrphans: z.number().int().min(1).max(200).optional(),
    maxDuplicatePairs: z.number().int().min(1).max(100).optional(),
    maxContradictionPairs: z.number().int().min(1).max(20).optional(),
    parentRunId: uuidSchema.nullable().optional(),
  }).strict(),
  z.object({
    agentName: z.literal("connector"),
    conceptId: uuidSchema,
    threshold: z.number().min(0).max(1).optional().default(0.75),
    topK: z.number().int().min(1).max(50).optional().default(10),
    parentRunId: uuidSchema.nullable().optional(),
  }).strict(),
  z.object({
    agentName: z.literal("staleness"),
    staleDays: z.number().int().min(1).max(365).optional().default(90),
    maxNotes: z.number().int().min(1).max(50).optional().default(20),
    scoreThreshold: z.number().min(0).max(1).optional().default(0.5),
    parentRunId: uuidSchema.nullable().optional(),
  }).strict(),
  z.object({
    agentName: z.literal("narrator"),
    noteId: uuidSchema,
    style: z.enum(["conversational", "educational", "debate"]).optional().default("conversational"),
    parentRunId: uuidSchema.nullable().optional(),
  }).strict(),
]);

export type Plan8AgentName = z.infer<typeof plan8AgentNameSchema>;
export type Plan8AgentRunInput = z.infer<typeof plan8AgentRunInputSchema>;

type Plan8AgentRunStatus = "running" | "failed";

interface ProjectScope {
  workspaceId: string;
}

interface NoteScope {
  workspaceId: string;
  projectId: string;
}

export class Plan8AgentRunError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 403 | 404 | 409 | 503,
    message = code,
  ) {
    super(message);
  }
}

export interface Plan8AgentRunRepository {
  findProjectScope(projectId: string): Promise<ProjectScope | null>;
  findNoteScope(noteId: string): Promise<NoteScope | null>;
  insertRun(values: {
    runId: string;
    workspaceId: string;
    projectId: string;
    userId: string;
    agentName: Plan8AgentName;
    parentRunId?: string | null;
    workflowId: string;
    status: Plan8AgentRunStatus;
    trajectoryUri: string;
  }): Promise<void>;
  markRunFailed(runId: string, errorClass: string, errorMessage: string): Promise<void>;
}

export interface Plan8AgentRunServiceOptions {
  repo?: Plan8AgentRunRepository;
  canReadProject?: (userId: string, projectId: string) => Promise<boolean>;
  canWriteProject?: (userId: string, projectId: string) => Promise<boolean>;
  canReadNote?: (userId: string, noteId: string) => Promise<boolean>;
  startWorkflow?: (args: StartPlan8WorkflowArgs) => Promise<void>;
  newRunId?: () => string;
  newWorkflowId?: (agentName: Plan8AgentName) => string;
}

export interface Plan8AgentRunResult {
  runId: string;
  workflowId: string;
  agentName: Plan8AgentName;
  status: Plan8AgentRunStatus;
}

interface StartPlan8WorkflowArgs {
  workflowType: string;
  workflowId: string;
  input: Record<string, unknown>;
}

export function createDrizzlePlan8AgentRunRepository(
  conn: DB = defaultDb,
): Plan8AgentRunRepository {
  return {
    async findProjectScope(projectId) {
      const [project] = await conn
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      return project ?? null;
    },
    async findNoteScope(noteId) {
      const [row] = await conn
        .select({
          workspaceId: projects.workspaceId,
          projectId: notes.projectId,
        })
        .from(notes)
        .innerJoin(projects, eq(projects.id, notes.projectId))
        .where(eq(notes.id, noteId))
        .limit(1);
      return row ?? null;
    },
    async insertRun(values) {
      await conn.insert(agentRuns).values({
        runId: values.runId,
        workspaceId: values.workspaceId,
        projectId: values.projectId,
        userId: values.userId,
        agentName: values.agentName,
        parentRunId: values.parentRunId ?? null,
        workflowId: values.workflowId,
        status: values.status,
        trajectoryUri: values.trajectoryUri,
      });
    },
    async markRunFailed(runId, errorClass, errorMessage) {
      await conn
        .update(agentRuns)
        .set({
          status: "failed",
          endedAt: new Date(),
          errorClass,
          errorMessage,
        })
        .where(eq(agentRuns.runId, runId));
    },
  };
}

export async function runPlan8Agent(
  projectId: string,
  userId: string,
  input: Plan8AgentRunInput,
  options?: Plan8AgentRunServiceOptions,
): Promise<Plan8AgentRunResult> {
  const repo = options?.repo ?? createDrizzlePlan8AgentRunRepository();
  const project = await repo.findProjectScope(projectId);
  if (!project) throw new Plan8AgentRunError("project_not_found", 404);

  await assertPlan8Access(projectId, userId, input, repo, options);

  const runId = options?.newRunId?.() ?? randomUUID();
  const workflowId = options?.newWorkflowId?.(input.agentName) ?? workflowIdFor(input.agentName);
  const workflow = workflowRequestFor({
    projectId,
    workspaceId: project.workspaceId,
    userId,
    workflowId,
    input,
  });

  await repo.insertRun({
    runId,
    workspaceId: project.workspaceId,
    projectId,
    userId,
    agentName: input.agentName,
    parentRunId: input.parentRunId ?? null,
    workflowId,
    status: "running",
    trajectoryUri: `pending://plan8/${input.agentName}/${runId}`,
  });

  try {
    await (options?.startWorkflow ?? startPlan8Workflow)(workflow);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Plan8 agent workflow could not be started.";
    await repo.markRunFailed(runId, "plan8_agent_start_failed", message);
    throw new Plan8AgentRunError("plan8_agent_start_failed", 503, message);
  }

  return {
    runId,
    workflowId,
    agentName: input.agentName,
    status: "running",
  };
}

async function assertPlan8Access(
  projectId: string,
  userId: string,
  input: Plan8AgentRunInput,
  repo: Plan8AgentRunRepository,
  options?: Plan8AgentRunServiceOptions,
): Promise<void> {
  if (requiresProjectWrite(input.agentName)) {
    if (!(await canWriteProject(userId, projectId, options))) {
      throw new Plan8AgentRunError("forbidden", 403);
    }
  } else if (!(await canReadProject(userId, projectId, options))) {
    throw new Plan8AgentRunError("forbidden", 403);
  }

  if (input.agentName === "synthesis") {
    for (const noteId of input.noteIds) {
      const note = await repo.findNoteScope(noteId);
      if (!note || note.projectId !== projectId) {
        throw new Plan8AgentRunError("note_not_found", 404);
      }
      if (!(await canReadNote(userId, noteId, options))) {
        throw new Plan8AgentRunError("note_not_found", 404);
      }
    }
  }

  if (input.agentName === "narrator") {
    const note = await repo.findNoteScope(input.noteId);
    if (!note || note.projectId !== projectId) {
      throw new Plan8AgentRunError("note_not_found", 404);
    }
    if (!(await canReadNote(userId, input.noteId, options))) {
      throw new Plan8AgentRunError("note_not_found", 404);
    }
  }
}

function workflowRequestFor(args: {
  projectId: string;
  workspaceId: string;
  userId: string;
  workflowId: string;
  input: Plan8AgentRunInput;
}): StartPlan8WorkflowArgs {
  const { projectId, workspaceId, userId, workflowId, input } = args;
  switch (input.agentName) {
    case "librarian":
      return {
        workflowType: "LibrarianWorkflow",
        workflowId,
        input: {
          project_id: projectId,
          workspace_id: workspaceId,
          user_id: userId,
          workflowId,
        },
      };
    case "synthesis":
      return {
        workflowType: "SynthesisWorkflow",
        workflowId,
        input: {
          note_ids: input.noteIds,
          project_id: projectId,
          workspace_id: workspaceId,
          user_id: userId,
          title: input.title ?? "Synthesis",
          style: input.style ?? "",
          workflowId,
        },
      };
    case "curator":
      return {
        workflowType: "CuratorWorkflow",
        workflowId,
        input: {
          project_id: projectId,
          workspace_id: workspaceId,
          user_id: userId,
          max_orphans: input.maxOrphans ?? 50,
          max_duplicate_pairs: input.maxDuplicatePairs ?? 20,
          max_contradiction_pairs: input.maxContradictionPairs ?? 5,
          workflowId,
        },
      };
    case "connector":
      return {
        workflowType: "ConnectorWorkflow",
        workflowId,
        input: {
          concept_id: input.conceptId,
          project_id: projectId,
          workspace_id: workspaceId,
          user_id: userId,
          threshold: input.threshold,
          top_k: input.topK,
          workflowId,
        },
      };
    case "staleness":
      return {
        workflowType: "StalenessWorkflow",
        workflowId,
        input: {
          workspace_id: workspaceId,
          project_id: projectId,
          user_id: userId,
          stale_days: input.staleDays,
          max_notes: input.maxNotes,
          score_threshold: input.scoreThreshold,
          workflowId,
        },
      };
    case "narrator":
      return {
        workflowType: "NarratorWorkflow",
        workflowId,
        input: {
          note_id: input.noteId,
          project_id: projectId,
          workspace_id: workspaceId,
          user_id: userId,
          style: input.style,
          workflowId,
        },
      };
  }
}

async function startPlan8Workflow(args: StartPlan8WorkflowArgs): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.start(args.workflowType, {
    taskQueue: taskQueue(),
    workflowId: args.workflowId,
    args: [args.input],
  });
}

function workflowIdFor(agentName: Plan8AgentName): string {
  return `${workflowPrefix(agentName)}-${randomUUID()}`;
}

function workflowPrefix(agentName: Plan8AgentName): string {
  return agentName === "staleness" ? "staleness" : agentName;
}

function requiresProjectWrite(agentName: Plan8AgentName): boolean {
  return agentName === "librarian" || agentName === "synthesis" || agentName === "curator";
}

async function canReadProject(
  userId: string,
  projectId: string,
  options?: Plan8AgentRunServiceOptions,
): Promise<boolean> {
  const check = options?.canReadProject
    ?? ((uid, pid) => canRead(uid, { type: "project", id: pid }));
  return check(userId, projectId);
}

async function canWriteProject(
  userId: string,
  projectId: string,
  options?: Plan8AgentRunServiceOptions,
): Promise<boolean> {
  const check = options?.canWriteProject
    ?? ((uid, pid) => canWrite(uid, { type: "project", id: pid }));
  return check(userId, projectId);
}

async function canReadNote(
  userId: string,
  noteId: string,
  options?: Plan8AgentRunServiceOptions,
): Promise<boolean> {
  const check = options?.canReadNote
    ?? ((uid, nid) => canRead(uid, { type: "note", id: nid }));
  return check(userId, noteId);
}
