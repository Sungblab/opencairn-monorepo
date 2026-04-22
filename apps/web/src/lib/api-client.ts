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
