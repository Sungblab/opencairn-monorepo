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

  return res.json() as Promise<T>;
}

// ---------- Types mirroring Hono route response shapes ----------
// Timestamps are serialized as ISO strings across the wire even though
// Drizzle returns `Date` server-side. `content` is stored as jsonb of a
// Plate Value (array of nodes) but we keep it typed as `unknown[] | null`
// so legacy payloads (objects pre-migration) don't break compilation.

export interface NoteRow {
  id: string;
  projectId: string;
  workspaceId: string;
  folderId: string | null;
  inheritParent: boolean;
  title: string;
  content: unknown[] | null;
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
