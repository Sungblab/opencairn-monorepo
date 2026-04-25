// apps/web/src/lib/api-client.ts
// Browser: same-origin (/api/... → proxied to Hono)
// Server Components: direct to internal API URL

const baseUrl = () =>
  typeof window === "undefined"
    ? (process.env.INTERNAL_API_URL ?? "http://localhost:4000")
    : "";

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
  const res = await fetch(`${baseUrl()}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
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
   * Plan 7 Canvas Phase 1: non-null only when sourceType='canvas'. The DB
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
  title?: string;
  content?: unknown[] | null;
  // Plan 7 Canvas Phase 1: canvas notes carry source code in contentText
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
};

export interface CommentResponse {
  id: string;
  noteId: string;
  parentId: string | null;
  anchorBlockId: string | null;
  authorId: string;
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
  updated_at: string;
  created_at: string;
}

export interface ChatMessageContent {
  body: string;
  scope?: unknown;
  thought?: { summary: string; tokens?: number };
  status?: { phrase?: string };
  citations?: unknown[];
  save_suggestion?: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  status: "streaming" | "complete" | "failed";
  content: ChatMessageContent;
  mode: string | null;
  provider: string | null;
  created_at: string;
}

export const chatApi = {
  listThreads: (workspaceId: string) =>
    apiClient<{ threads: ChatThread[] }>(
      `/threads?workspace_id=${encodeURIComponent(workspaceId)}`,
    ),
  createThread: (workspaceId: string, title?: string) =>
    apiClient<{ id: string; title: string }>(`/threads`, {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceId,
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
  listFolders: (projectId: string) =>
    apiClient<FolderRow[]>(`/folders/by-project/${projectId}`),
};
