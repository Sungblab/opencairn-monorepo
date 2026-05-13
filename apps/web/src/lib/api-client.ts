// apps/web/src/lib/api-client.ts
// Browser: same-origin (/api/... → proxied to Hono)
// Server Components: direct to internal API URL

import type { UserPlan } from "@opencairn/shared";
import type {
  AgentAction,
  AgentActionKind,
  AgentActionStatus,
  AgenticPlan,
  CreateAgenticPlanRequest,
  DocumentGenerationFormat,
  DocumentGenerationSource,
  GenerateProjectObjectAction,
  ImageRenderEngine,
  InteractionChoiceRespondRequest,
  PdfRenderEngine,
  NoteUpdateApplyRequest,
  ProjectObjectAction,
  RecoverAgenticPlanStepRequest,
  SessionRecording,
  StudySession,
  StudySessionTranscriptResponse,
  StartAgenticPlanRequest,
  TransitionAgentActionStatusRequest,
  WorkflowConsoleRun,
  WorkflowConsoleStatus,
} from "@opencairn/shared";
import type { AgentInteractionCard } from "@/components/agent-panel/interaction-card";
export type {
  AgentAction,
  AgentActionKind,
  AgentActionStatus,
} from "@opencairn/shared";

const baseUrl = () =>
  typeof window === "undefined"
    ? (process.env.INTERNAL_API_URL ?? "http://localhost:4000")
    : "";

// Server Components: `credentials: "include"` is a browser-only directive and
// does nothing inside Node `fetch`. Without an explicit `cookie` header the
// API receives no session and rightly returns 401. Read Better Auth's cookie
// jar via `next/headers` and forward it. Dynamic-import keeps the client
// bundle from pulling a server-only module.
//
// Vitest's node environment satisfies `typeof window === "undefined"` but
// has no Next.js request scope, so `cookies()` throws. The try/catch swallows
// that branch and returns the empty header — tests that mock `fetch` directly
// don't care about cookies anyway.
async function getServerCookieHeader(): Promise<string> {
  if (typeof window !== "undefined") return "";
  try {
    const { cookies } = await import("next/headers");
    return (await cookies()).toString();
  } catch {
    return "";
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiClient<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  // Multipart uploads (Plan 7 Canvas Phase 2 — `useCanvasOutputs.upload`) need
  // the browser to set `Content-Type: multipart/form-data; boundary=...`. If
  // we forced `application/json` here the server would lose the boundary and
  // fail to parse the FormData. Detect FormData and skip the default header.
  const isFormData =
    typeof FormData !== "undefined" && options?.body instanceof FormData;
  const baseHeaders: Record<string, string> = isFormData
    ? {}
    : { "Content-Type": "application/json" };

  const cookieHeader = await getServerCookieHeader();
  // Build a single Record<string,string> so the spread types collapse cleanly
  // and don't wander into the `Headers | string[][]` branches of HeadersInit.
  // Caller-provided headers go in last so they can still override.
  const mergedHeaders: Record<string, string> = { ...baseHeaders };
  if (cookieHeader) mergedHeaders.cookie = cookieHeader;
  if (options?.headers) {
    const ch = options.headers as Record<string, string>;
    Object.assign(mergedHeaders, ch);
  }

  const res = await fetch(`${baseUrl()}/api${path}`, {
    credentials: "include",
    ...options,
    headers: mergedHeaders,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `API error ${res.status}`);
  }

  // 204 No Content (e.g. DELETE /comments/:id) has no body. Calling
  // `res.json()` on it throws "Unexpected end of JSON input" in Chrome. Return
  // `undefined` cast to the caller's T — callers that pass `<void>` get
  // `undefined` back; anyone passing a non-void type on a 204 endpoint is
  // misusing the helper.
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ---------- Types mirroring Hono route response shapes ----------
// Timestamps are serialized as ISO strings across the wire even though
// Drizzle returns `Date` server-side. `content` is stored as jsonb with a
// Plate Value (array of nodes) in the canonical case, but legacy rows may
// hold objects or null. We type it as `unknown` so consumers must narrow at
// the Plate boundary via `parseEditorContent` in editor-utils.

export interface NoteRow {
  id: string;
  projectId: string;
  workspaceId: string;
  folderId: string | null;
  inheritParent: boolean;
  title: string;
  /**
   * jsonb from DB. Plate Value is an array; legacy rows may be object or
   * null — narrow at editor boundary via `parseEditorContent`.
   */
  content: unknown;
  contentText: string | null;
  type: "note" | "wiki" | "source";
  sourceType: string | null;
  sourceFileKey: string | null;
  sourceUrl: string | null;
  mimeType: string | null;
  /**
   * Canvas runtime: non-null only when sourceType='canvas'. The DB
   * CHECK constraint enforces the iff between sourceType='canvas' and
   * canvasLanguage IS NOT NULL.
   */
  canvasLanguage: "python" | "javascript" | "html" | "react" | null;
  isAuto: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NoteSearchHit {
  id: string;
  title: string;
  updatedAt: string;
}

export interface PatchNoteBody {
  title?: string;
  content?: unknown[] | null;
  folderId?: string | null;
}

export interface CreateNoteBody {
  projectId: string;
  folderId?: string | null;
  parentTreeNodeId?: string | null;
  title?: string;
  content?: unknown[] | null;
  // Canvas runtime: canvas notes carry source code in contentText
  // and a non-null canvasLanguage. The DB CHECK constraint enforces the
  // iff between sourceType='canvas' and canvasLanguage IS NOT NULL.
  sourceType?:
    | "manual"
    | "pdf"
    | "audio"
    | "video"
    | "image"
    | "youtube"
    | "web"
    | "notion"
    | "unknown"
    | "canvas";
  canvasLanguage?: "python" | "javascript" | "html" | "react";
  contentText?: string;
}

export type PdfAnnotationPayload = Array<Record<string, unknown>>;

export interface PdfAnnotationsResponse {
  noteId: string;
  annotations: PdfAnnotationPayload;
  updatedAt: string | null;
}

export interface FolderRow {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

// ---------- Typed helpers ----------
// Endpoints match apps/api/src/routes/notes.ts and folders.ts.
// Both resources use `/by-project/:projectId` (path param, not query).

// ---------- Comment types (mirror @opencairn/shared comment-types) ----------
// `shared` isn't a runtime dep of @opencairn/web (no cross-package imports in
// app code today), so we mirror the wire shapes here. Keep in sync with
// packages/shared/src/comment-types.ts if the schema changes.

export type MentionToken = {
  type: "user" | "page" | "concept" | "date";
  id: string;
  label?: string;
};

export interface CommentResponse {
  id: string;
  noteId: string;
  parentId: string | null;
  anchorBlockId: string | null;
  authorId: string;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  body: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  mentions: MentionToken[];
}

export interface CreateCommentInput {
  body: string;
  anchorBlockId?: string | null;
  parentId?: string | null;
}

export interface UpdateCommentInput {
  body: string;
}

export const commentsApi = {
  list: (noteId: string) =>
    apiClient<{ comments: CommentResponse[] }>(`/notes/${noteId}/comments`),
  create: (noteId: string, body: CreateCommentInput) =>
    apiClient<CommentResponse>(`/notes/${noteId}/comments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: UpdateCommentInput) =>
    apiClient<CommentResponse>(`/comments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    apiClient<void>(`/comments/${id}`, { method: "DELETE" }),
  resolve: (id: string) =>
    apiClient<CommentResponse>(`/comments/${id}/resolve`, {
      method: "POST",
    }),
};

// ---------- Chat threads + messages (App Shell Phase 4) ----------
// The agent panel renders a per-workspace thread list in its header dropdown
// and a per-thread message log in its body. Both are jsonb-heavy on the wire
// — `content` is whatever the SSE pipeline persisted (body + thought + status
// + citations + save_suggestion). We type the well-known keys but keep the
// long tail (`scope`, `citations`, `save_suggestion`) as `unknown` so callers
// must narrow at the renderer boundary instead of leaking shape assumptions
// into hooks.

export interface ChatThread {
  id: string;
  title: string;
  last_message_preview?: string | null;
  updated_at: string;
  created_at: string;
}

export interface ChatMessageContent {
  body: string;
  scope?: unknown;
  interaction_card?: AgentInteractionCard;
  thought?: { summary: string; tokens?: number };
  status?: { phrase?: string };
  citations?: unknown[];
  save_suggestion?: unknown;
  error?: unknown;
  agent_files?: unknown[];
  agent_actions?: unknown[];
  project_objects?: unknown[];
  project_object_generations?: unknown[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  status: "streaming" | "complete" | "failed";
  run_id?: string | null;
  run_status?:
    | "queued"
    | "running"
    | "complete"
    | "failed"
    | "cancelled"
    | null;
  content: ChatMessageContent;
  mode: string | null;
  provider: string | null;
  created_at: string;
}

export const chatApi = {
  listThreads: (workspaceId: string, projectId?: string | null) => {
    const query = new URLSearchParams({ workspace_id: workspaceId });
    if (projectId) query.set("project_id", projectId);
    return apiClient<{ threads: ChatThread[] }>(`/threads?${query.toString()}`);
  },
  createThread: (workspaceId: string, title?: string, projectId?: string | null) =>
    apiClient<{ id: string; title: string }>(`/threads`, {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceId,
        ...(projectId ? { project_id: projectId } : {}),
        ...(title ? { title } : {}),
      }),
    }),
  renameThread: (id: string, title: string) =>
    apiClient<{ ok: true }>(`/threads/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  archiveThread: (id: string) =>
    apiClient<{ ok: true }>(`/threads/${id}`, { method: "DELETE" }),
  listMessages: (threadId: string) =>
    apiClient<{ messages: ChatMessage[] }>(`/threads/${threadId}/messages`),
  // Feedback is fire-and-forget upsert. We omit `reason` from the body when
  // missing so the server-side zod schema doesn't have to special-case empty
  // strings.
  submitFeedback: (
    messageId: string,
    sentiment: "positive" | "negative",
    reason?: string,
  ) =>
    apiClient<{ ok: true }>(`/message-feedback`, {
      method: "POST",
      body: JSON.stringify({
        message_id: messageId,
        sentiment,
        ...(reason ? { reason } : {}),
      }),
    }),
};

// ---------- Agent actions ----------

export interface AgentActionListOptions {
  status?: AgentActionStatus;
  kind?: AgentActionKind;
  limit?: number;
}

export const agentActionsApi = {
  list: (projectId: string, opts: AgentActionListOptions = {}) => {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.kind) params.set("kind", opts.kind);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return apiClient<{ actions: AgentAction[] }>(
      `/projects/${projectId}/agent-actions${qs ? `?${qs}` : ""}`,
    );
  },
  get: (id: string) =>
    apiClient<{ action: AgentAction }>(`/agent-actions/${id}`),
  respondToInteractionChoice: (
    id: string,
    body: InteractionChoiceRespondRequest,
  ) =>
    apiClient<{ action: AgentAction }>(`/agent-actions/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  applyNoteUpdate: (id: string, body: NoteUpdateApplyRequest) =>
    apiClient<{ action: AgentAction }>(`/agent-actions/${id}/apply`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  applyCodeProjectPatch: (id: string) =>
    apiClient<{ action: AgentAction }>(`/agent-actions/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  applyCodeProjectPreview: (id: string) =>
    apiClient<{ action: AgentAction }>(`/agent-actions/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  applyCodeProjectInstall: (id: string) =>
    apiClient<{ action: AgentAction }>(`/agent-actions/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  apply: (id: string) =>
    apiClient<{ action: AgentAction }>(`/agent-actions/${id}/apply`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  transitionStatus: (
    id: string,
    body: Pick<TransitionAgentActionStatusRequest, "status">,
  ) =>
    apiClient<{ action: AgentAction }>(`/agent-actions/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

export interface AgenticPlanListOptions {
  status?: AgenticPlan["status"];
  limit?: number;
}

export const agenticPlansApi = {
  list: (projectId: string, opts: AgenticPlanListOptions = {}) => {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return apiClient<{ plans: AgenticPlan[] }>(
      `/projects/${projectId}/agentic-plans${qs ? `?${qs}` : ""}`,
    );
  },
  create: (projectId: string, body: CreateAgenticPlanRequest) =>
    apiClient<{ plan: AgenticPlan }>(`/projects/${projectId}/agentic-plans`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  get: (projectId: string, planId: string) =>
    apiClient<{ plan: AgenticPlan }>(
      `/projects/${projectId}/agentic-plans/${planId}`,
    ),
  start: (
    projectId: string,
    planId: string,
    body: StartAgenticPlanRequest = {},
  ) =>
    apiClient<{ plan: AgenticPlan }>(
      `/projects/${projectId}/agentic-plans/${planId}/start`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  recover: (
    projectId: string,
    planId: string,
    body: RecoverAgenticPlanStepRequest,
  ) =>
    apiClient<{ plan: AgenticPlan }>(
      `/projects/${projectId}/agentic-plans/${planId}/recover`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
};

export type { AgenticPlan };

export type DocumentGenerationSourceOption = {
  id: string;
  type: DocumentGenerationSource["type"];
  title: string;
  subtitle?: string;
  source: DocumentGenerationSource;
  qualitySignals?: string[];
};

export type GenerateProjectObjectResponse = {
  action: AgentAction;
  event: unknown;
  idempotent: boolean;
  workflowId?: string;
};
type ExportProjectObjectAction = Extract<
  ProjectObjectAction,
  { type: "export_project_object" }
>;

export const documentGenerationApi = {
  sources: (projectId: string) =>
    apiClient<{ sources: DocumentGenerationSourceOption[] }>(
      `/projects/${projectId}/document-generation/sources`,
    ),
  generate: (projectId: string, body: GenerateProjectObjectAction) =>
    apiClient<GenerateProjectObjectResponse>(
      `/projects/${projectId}/project-object-actions/generate`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  exportProjectObject: (projectId: string, body: ExportProjectObjectAction) =>
    apiClient<GenerateProjectObjectResponse>(
      `/projects/${projectId}/project-object-actions/export`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
};

export type {
  DocumentGenerationFormat,
  DocumentGenerationSource,
  ImageRenderEngine,
  PdfRenderEngine,
};

export const workflowConsoleApi = {
  list: (
    projectId: string,
    options:
      | number
      | {
          limit?: number;
          status?: WorkflowConsoleStatus;
          q?: string;
        } = 5,
  ) => {
    const params = new URLSearchParams();
    if (typeof options === "number") {
      params.set("limit", String(options));
    } else {
      params.set("limit", String(options.limit ?? 5));
      if (options.status) params.set("status", options.status);
      if (options.q) params.set("q", options.q);
    }
    return apiClient<{ runs: WorkflowConsoleRun[] }>(
      `/projects/${projectId}/workflow-console/runs?${params.toString()}`,
    );
  },
  get: (projectId: string, runId: string) =>
    apiClient<{ run: WorkflowConsoleRun }>(
      `/projects/${projectId}/workflow-console/runs/${encodeURIComponent(runId)}`,
    ),
};

export type { WorkflowConsoleRun, WorkflowConsoleStatus };

export const studySessionsApi = {
  list: (projectId: string, options?: { sourceNoteId?: string }) => {
    const params = new URLSearchParams();
    if (options?.sourceNoteId) params.set("sourceNoteId", options.sourceNoteId);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return apiClient<{ sessions: StudySession[] }>(
      `/projects/${projectId}/study-sessions${suffix}`,
    );
  },
  create: (body: {
    projectId: string;
    title?: string;
    sourceNoteId?: string;
  }) =>
    apiClient<{ session: StudySession }>("/study-sessions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  recordings: (sessionId: string) =>
    apiClient<{ recordings: SessionRecording[] }>(
      `/study-sessions/${sessionId}/recordings`,
    ),
  uploadRecording: (
    sessionId: string,
    file: File,
    options?: { durationSec?: number | null },
  ) => {
    const body = new FormData();
    body.set("file", file);
    if (options?.durationSec != null) {
      body.set("durationSec", String(options.durationSec));
    }
    return apiClient<{ recording: SessionRecording; workflowId: string }>(
      `/study-sessions/${sessionId}/recordings/upload`,
      { method: "POST", body },
    );
  },
  transcript: (sessionId: string) =>
    apiClient<StudySessionTranscriptResponse>(
      `/study-sessions/${sessionId}/transcript`,
    ),
  recordingFileUrl: (sessionId: string, recordingId: string) =>
    `/api/study-sessions/${sessionId}/recordings/${recordingId}/file`,
};

export type { SessionRecording, StudySession, StudySessionTranscriptResponse };

export const pdfAnnotationsApi = {
  get: (noteId: string) =>
    apiClient<PdfAnnotationsResponse>(`/notes/${noteId}/pdf-annotations`),
  save: (noteId: string, annotations: PdfAnnotationPayload) =>
    apiClient<PdfAnnotationsResponse>(`/notes/${noteId}/pdf-annotations`, {
      method: "PUT",
      body: JSON.stringify({ annotations }),
    }),
};

export const importJobsApi = {
  retry: (jobId: string) =>
    apiClient<{ jobId: string; action: AgentAction | null }>(
      `/import/jobs/${jobId}/retry`,
      { method: "POST" },
    ),
  cancel: (jobId: string) =>
    apiClient<{ ok: true }>(`/import/jobs/${jobId}`, { method: "DELETE" }),
};

// ---------- Dashboard / workspace summary (Phase 5 Task 1) ----------
// snake_case keys mirror the server contract — see workspaces.ts stats /
// recent-notes routes. Kept verbatim so consumers can dump straight into
// the JSX without an extra translation layer.

export interface WorkspaceStats {
  docs: number;
  docs_week_delta: number;
  research_in_progress: number;
  /** KRW. 0 until hosted billing ships. */
  credits_krw: number;
  byok_connected: boolean;
}

export interface RecentNoteSummary {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  updated_at: string;
  excerpt: string | null;
}

export interface ResearchRunSummary {
  id: string;
  topic: string;
  model: string;
  status:
    | "planning"
    | "awaiting_approval"
    | "researching"
    | "completed"
    | "failed"
    | "cancelled";
  billingPath: "managed" | "byok";
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  totalCostUsdCents: number | null;
  noteId: string | null;
}

export const dashboardApi = {
  stats: (workspaceId: string) =>
    apiClient<WorkspaceStats>(`/workspaces/${workspaceId}/stats`),
  recentNotes: (workspaceId: string, limit = 5) =>
    apiClient<{ notes: RecentNoteSummary[] }>(
      `/workspaces/${workspaceId}/recent-notes?limit=${limit}`,
    ),
  researchRuns: (workspaceId: string, limit = 20) =>
    apiClient<{ runs: ResearchRunSummary[] }>(
      `/research/runs?workspaceId=${workspaceId}&limit=${limit}`,
    ),
};

// ---------- Project view (Phase 5 Task 2) ----------

export interface ProjectMeta {
  id: string;
  name: string;
  description: string | null;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export type ProjectNoteKind = "imported" | "research" | "manual";

export interface ProjectNoteRow {
  id: string;
  title: string;
  kind: ProjectNoteKind;
  updated_at: string;
}

export interface ProjectWikiIndexPage {
  id: string;
  title: string;
  type: "note" | "wiki" | "source";
  sourceType: string | null;
  summary: string;
  updatedAt: string;
  inboundLinks: number;
  outboundLinks: number;
}

export interface ProjectWikiIndexLink {
  sourceNoteId: string;
  sourceTitle: string;
  targetNoteId: string;
  targetTitle: string;
}

export interface ProjectWikiIndexUnresolvedLink {
  sourceNoteId: string;
  sourceTitle: string;
  targetTitle: string;
  reason: "missing" | "ambiguous";
}

export interface ProjectWikiIndexLog {
  noteId: string;
  noteTitle: string;
  agent: string;
  action: string;
  reason: string | null;
  createdAt: string;
}

export type ProjectWikiIndexHealthStatus =
  | "healthy"
  | "updating"
  | "needs_attention"
  | "blocked";

export type ProjectWikiIndexHealthIssueKind =
  | "analysis_failed"
  | "analysis_running"
  | "analysis_queued"
  | "analysis_stale"
  | "unresolved_missing"
  | "unresolved_ambiguous"
  | "orphan_pages";

export interface ProjectWikiIndexHealthIssue {
  kind: ProjectWikiIndexHealthIssueKind;
  severity: "info" | "warning" | "blocking";
  count: number;
  sampleTitles: string[];
}

export interface ProjectWikiIndexHealth {
  status: ProjectWikiIndexHealthStatus;
  issues: ProjectWikiIndexHealthIssue[];
}

export interface ProjectWikiIndex {
  projectId: string;
  generatedAt: string;
  latestPageUpdatedAt: string | null;
  totals: {
    pages: number;
    wikiLinks: number;
    orphanPages: number;
  };
  health: ProjectWikiIndexHealth;
  links: ProjectWikiIndexLink[];
  unresolvedLinks: ProjectWikiIndexUnresolvedLink[];
  recentLogs: ProjectWikiIndexLog[];
  pages: ProjectWikiIndexPage[];
}

export interface ProjectPermissionsSummary {
  role: "owner" | "admin" | "editor" | "viewer" | "none";
  overrides: Record<string, string>;
}

export interface ProjectWikiIndexRefreshResult {
  projectId: string;
  noteIds: string[];
  queuedNoteAnalysisJobs: number;
  skippedNotes: number;
  limit: number;
}

export const projectsApi = {
  get: (id: string) => apiClient<ProjectMeta>(`/projects/${id}`),
  create: (workspaceId: string, body: { name: string; description?: string }) =>
    apiClient<ProjectMeta>(`/workspaces/${workspaceId}/projects`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: { name?: string; description?: string }) =>
    apiClient<ProjectMeta>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  notes: (id: string, filter: "all" | ProjectNoteKind = "all") =>
    apiClient<{ notes: ProjectNoteRow[] }>(
      `/projects/${id}/notes?filter=${filter}`,
    ),
  wikiIndex: (id: string) =>
    apiClient<ProjectWikiIndex>(`/projects/${id}/wiki-index`),
  refreshWikiIndex: (id: string) =>
    apiClient<ProjectWikiIndexRefreshResult>(
      `/projects/${id}/wiki-index/refresh`,
      { method: "POST" },
    ),
  permissions: (id: string) =>
    apiClient<ProjectPermissionsSummary>(`/projects/${id}/permissions`),
};

// ---------- Plan 8 agent entrypoints ----------

export type Plan8AgentName =
  | "librarian"
  | "synthesis"
  | "curator"
  | "connector"
  | "staleness"
  | "narrator";

export interface Plan8LaunchNote {
  id: string;
  title: string;
  type: "note" | "wiki" | "source";
  updatedAt: string;
}

export interface Plan8LaunchConcept {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface Plan8AgentRun {
  runId: string;
  agentName: Plan8AgentName;
  workflowId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  totalCostKrw: number;
  errorMessage: string | null;
}

export interface Plan8Suggestion {
  id: string;
  type:
    | "connector_link"
    | "curator_orphan"
    | "curator_duplicate"
    | "curator_contradiction"
    | "curator_external_source"
    | "synthesis_insight";
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Plan8StaleAlert {
  id: string;
  noteId: string;
  noteTitle: string;
  stalenessScore: number;
  reason: string;
  detectedAt: string;
  reviewedAt: string | null;
}

export interface Plan8AudioFile {
  id: string;
  noteId: string;
  noteTitle: string;
  durationSec: number | null;
  voices: Array<{ name: string; style?: string }> | null;
  createdAt: string;
  urlPath: string;
}

export interface Plan8Overview {
  project: { id: string; workspaceId: string };
  launch: {
    notes: Plan8LaunchNote[];
    concepts: Plan8LaunchConcept[];
  };
  agentRuns: Plan8AgentRun[];
  suggestions: Plan8Suggestion[];
  staleAlerts: Plan8StaleAlert[];
  audioFiles: Plan8AudioFile[];
}

export const plan8AgentsApi = {
  overview: (projectId: string) =>
    apiClient<Plan8Overview>(
      `/agents/plan8/overview?projectId=${encodeURIComponent(projectId)}`,
    ),
  runSynthesis: (body: {
    projectId: string;
    noteIds: string[];
    title?: string;
    style?: string;
  }) =>
    apiClient<{ workflowId: string }>(`/synthesis/run`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  runLibrarian: (body: { projectId: string }) =>
    apiClient<{ workflowId: string }>(`/librarian/run`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  runCurator: (body: { projectId: string }) =>
    apiClient<{ workflowId: string }>(`/curator/run`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  runConnector: (body: { projectId: string; conceptId: string }) =>
    apiClient<{ workflowId: string }>(`/connector/run`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  runStaleness: (body: { projectId: string }) =>
    apiClient<{ workflowId: string }>(`/agents/temporal/stale-check`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  runNarrator: (body: {
    noteId: string;
    style?: "conversational" | "educational" | "debate";
  }) =>
    apiClient<{ workflowId: string }>(`/narrator/run`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  resolveSuggestion: (id: string, status: "accepted" | "rejected") =>
    apiClient<{ ok: true; status: "accepted" | "rejected" }>(
      `/agents/plan8/suggestions/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ status }),
      },
    ),
  reviewStaleAlert: (id: string) =>
    apiClient<{ ok: true }>(
      `/agents/plan8/stale-alerts/${encodeURIComponent(id)}/review`,
      {
        method: "PATCH",
      },
    ),
};

// ---------- Workspace settings (Phase 5 Task 6) ----------

export type WorkspaceRole = "owner" | "admin" | "member" | "guest";

export interface WorkspaceMemberRow {
  userId: string;
  role: WorkspaceRole;
  email: string;
  name: string;
}

export interface WorkspaceInviteRow {
  id: string;
  email: string;
  role: "admin" | "member" | "guest";
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface GoogleIntegrationStatus {
  connected: boolean;
  accountEmail: string | null;
  scopes: string | null;
}

export type WorkspaceSharedLinkRow = {
  id: string;
  token: string;
  role: "viewer" | "commenter" | "editor";
  noteId: string;
  noteTitle: string;
  createdAt: string;
  createdBy: { id: string; name: string };
};

export const wsSettingsApi = {
  members: (workspaceId: string) =>
    apiClient<WorkspaceMemberRow[]>(`/workspaces/${workspaceId}/members`),
  patchMemberRole: (
    workspaceId: string,
    userId: string,
    role: "admin" | "member" | "guest",
  ) =>
    apiClient<{ ok: true }>(`/workspaces/${workspaceId}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  removeMember: (workspaceId: string, userId: string) =>
    apiClient<{ ok: true }>(`/workspaces/${workspaceId}/members/${userId}`, {
      method: "DELETE",
    }),
  invites: (workspaceId: string) =>
    apiClient<WorkspaceInviteRow[]>(`/workspaces/${workspaceId}/invites`),
  createInvite: (
    workspaceId: string,
    email: string,
    role: "admin" | "member" | "guest" = "member",
  ) =>
    apiClient<{ id: string }>(`/workspaces/${workspaceId}/invites`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),
  cancelInvite: (workspaceId: string, inviteId: string) =>
    apiClient<{ ok: true }>(`/workspaces/${workspaceId}/invites/${inviteId}`, {
      method: "DELETE",
    }),
  sharedLinks: (workspaceId: string) =>
    apiClient<{ links: WorkspaceSharedLinkRow[] }>(
      `/workspaces/${workspaceId}/share`,
    ),
};

export const integrationsApi = {
  google: (workspaceId: string) =>
    apiClient<GoogleIntegrationStatus>(
      `/integrations/google?workspaceId=${encodeURIComponent(workspaceId)}`,
    ),
  disconnectGoogle: (workspaceId: string) =>
    apiClient<{ ok: true }>(
      `/integrations/google?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: "DELETE" },
    ),
};

// ---------- Account / current user (Phase 5 Task 7) ----------

export interface MeProfile {
  id: string;
  email: string;
  name: string;
  image: string | null;
  plan: UserPlan;
  /** Server returns null until locale/timezone columns ship. */
  locale: string | null;
  timezone: string | null;
}

export const meApi = {
  get: () => apiClient<MeProfile>(`/users/me`),
  patch: (body: { name?: string }) =>
    apiClient<{ ok: true }>(`/users/me`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

// ---------- Notification preferences (Plan 2 Task 14) ----------

export type NotificationFrequency = "instant" | "digest_15min" | "digest_daily";
export type NotificationPreferenceKind =
  | "mention"
  | "comment_reply"
  | "research_complete"
  | "share_invite"
  | "system";

export interface NotificationPreferenceRow {
  kind: NotificationPreferenceKind;
  emailEnabled: boolean;
  frequency: NotificationFrequency;
}

export interface NotificationProfileRow {
  locale: "ko" | "en";
  timezone: string;
}

export const notificationPreferencesApi = {
  list: () =>
    apiClient<{ preferences: NotificationPreferenceRow[] }>(
      `/notification-preferences`,
    ),
  upsert: (
    kind: NotificationPreferenceKind,
    body: Omit<NotificationPreferenceRow, "kind">,
  ) =>
    apiClient<NotificationPreferenceRow>(`/notification-preferences/${kind}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  profile: () =>
    apiClient<NotificationProfileRow>(`/notification-preferences/profile`),
  updateProfile: (body: Partial<NotificationProfileRow>) =>
    apiClient<NotificationProfileRow>(`/notification-preferences/profile`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};

// ---------- Workspace text search (Phase 5 Task 8 / palette) ----------

export interface WorkspaceNoteSearchHit {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  updated_at: string;
}

export const searchApi = {
  workspaceNotes: (workspaceId: string, q: string, limit = 20) =>
    apiClient<{ results: WorkspaceNoteSearchHit[] }>(
      `/workspaces/${workspaceId}/notes/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
};

// ---------- Notifications drawer (Phase 5 Task 10) ----------

export type NotificationKind =
  | "mention"
  | "comment_reply"
  | "research_complete"
  | "share_invite"
  | "system";

export interface NotificationRow {
  id: string;
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  created_at: string;
  seen_at: string | null;
  read_at: string | null;
}

export interface NotificationsListResponse {
  notifications: NotificationRow[];
  /** Opaque cursor for the next page; `null` when no more rows exist. */
  nextCursor: string | null;
}

export const notificationsApi = {
  list: (opts: { cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return apiClient<NotificationsListResponse>(
      `/notifications${qs ? `?${qs}` : ""}`,
    );
  },
  markRead: (id: string) =>
    apiClient<{ ok: true }>(`/notifications/${id}/read`, { method: "PATCH" }),
};

// ---------- Public share viewer (Plan 2C Task 8) ----------
// Unlike everything else in this module, the share viewer is unauthenticated.
// We bypass `apiClient` (which sends `credentials: "include"`) and use a raw
// `fetch` with `credentials: "omit"` so the share token is the ONLY identity
// signal — no session cookie leaks to the public endpoint, and the API can
// rate-limit purely by IP. The endpoint lives at `/api/public/share/:token`
// (registered before the auth wildcard in `apps/api/src/routes/share.ts`).

export interface PublicShareNote {
  id: string;
  title: string;
  role: "viewer" | "commenter" | "editor";
  /** Plate value array as returned by `yjs-to-plate` server-side. */
  plateValue: Array<Record<string, unknown>>;
  updatedAt: string;
}

export async function fetchPublicShare(
  token: string,
): Promise<PublicShareNote> {
  const res = await fetch(
    `${baseUrl()}/api/public/share/${encodeURIComponent(token)}`,
    {
      credentials: "omit",
      // Disable Next.js Data Cache for this request: share-link state is
      // mutable (revoke flips the row) and we don't want a stale 200 to
      // outlive a revoke. The page itself is rendered SSR per request.
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new ApiError(res.status, `share_status_${res.status}`);
  }
  const body = (await res.json()) as { note: PublicShareNote };
  return body.note;
}

// ---------- Plan 2C: share links + per-note permissions (Task 9) ----------
// Drives the ShareDialog (Invite people + Share to web). All routes go through
// `apiClient` (credentials: include) — only the unauthenticated public viewer
// (`fetchPublicShare` above) bypasses the cookie. The shapes match the Hono
// response bodies in apps/api/src/routes/share.ts and the
// `/workspaces/:workspaceId/members/search` route in workspaces.ts.

export type ShareLinkRow = {
  id: string;
  token: string;
  role: "viewer" | "commenter" | "editor";
  createdAt: string;
  createdBy: { id: string; name: string };
};

export type PagePermissionRow = {
  userId: string;
  role: "viewer" | "commenter" | "editor";
  grantedBy: string | null;
  createdAt: string;
  name: string;
  email: string;
};

export type WorkspaceMemberSearchRow = {
  userId: string;
  role: string;
  name: string;
  email: string;
};

export const shareApi = {
  list: (noteId: string) =>
    apiClient<{ links: ShareLinkRow[] }>(`/notes/${noteId}/share`),
  create: (noteId: string, role: "viewer" | "commenter") =>
    apiClient<ShareLinkRow>(`/notes/${noteId}/share`, {
      method: "POST",
      body: JSON.stringify({ role }),
    }),
  // Note: revoke uses a flat /share/:shareId path, NOT scoped to noteId — the
  // server resolves the note from the shareId and runs the auth check from
  // there (matches apps/api/src/routes/share.ts `DELETE /share/:shareId`).
  revoke: (shareId: string) =>
    apiClient<void>(`/share/${shareId}`, { method: "DELETE" }),
};

export const notePermissionsApi = {
  list: (noteId: string) =>
    apiClient<{ permissions: PagePermissionRow[] }>(
      `/notes/${noteId}/permissions`,
    ),
  grant: (
    noteId: string,
    userId: string,
    role: "viewer" | "commenter" | "editor",
  ) =>
    apiClient<PagePermissionRow>(`/notes/${noteId}/permissions`, {
      method: "POST",
      body: JSON.stringify({ userId, role }),
    }),
  update: (
    noteId: string,
    userId: string,
    role: "viewer" | "commenter" | "editor",
  ) =>
    apiClient<PagePermissionRow>(`/notes/${noteId}/permissions/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  revoke: (noteId: string, userId: string) =>
    apiClient<void>(`/notes/${noteId}/permissions/${userId}`, {
      method: "DELETE",
    }),
};

export const workspaceMembersApi = {
  // Backend route is `/workspaces/:workspaceId/members/search` — the path
  // segment is just a value here, so naming the local var `wsId` is fine.
  search: (wsId: string, q: string) =>
    apiClient<{ members: WorkspaceMemberSearchRow[] }>(
      `/workspaces/${wsId}/members/search?q=${encodeURIComponent(q)}`,
    ),
};

export const api = {
  getNote: (id: string) => apiClient<NoteRow>(`/notes/${id}`),
  listNotesByProject: (projectId: string) =>
    apiClient<NoteRow[]>(`/notes/by-project/${projectId}`),
  searchNotes: (q: string, projectId: string) =>
    apiClient<NoteSearchHit[]>(
      `/notes/search?q=${encodeURIComponent(q)}&projectId=${projectId}`,
    ),
  patchNote: (id: string, body: PatchNoteBody) =>
    apiClient<NoteRow>(`/notes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  createNote: (body: CreateNoteBody) =>
    apiClient<NoteRow>(`/notes`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createFolder: (body: {
    projectId: string;
    parentId?: string | null;
    name: string;
  }) =>
    apiClient<FolderRow>(`/folders`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listFolders: (projectId: string) =>
    apiClient<FolderRow[]>(`/folders/by-project/${projectId}`),
};
