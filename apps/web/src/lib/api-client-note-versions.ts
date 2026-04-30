import { apiClient } from "@/lib/api-client";

export type NoteVersionActorType = "user" | "agent" | "system";
export type NoteVersionSource =
  | "auto_save"
  | "title_change"
  | "ai_edit"
  | "restore"
  | "manual_checkpoint"
  | "import";

export interface NoteVersionActor {
  type: NoteVersionActorType;
  id: string | null;
  name: string | null;
}

export interface NoteVersionListItem {
  id: string;
  version: number;
  title: string;
  contentTextPreview: string;
  actor: NoteVersionActor;
  source: NoteVersionSource;
  reason: string | null;
  createdAt: string;
}

export interface NoteVersionListResponse {
  versions: NoteVersionListItem[];
  nextCursor: string | null;
}

export interface NoteVersionDetail extends NoteVersionListItem {
  content: unknown;
  contentText: string;
}

export interface NoteVersionTextDiffPart {
  kind: "equal" | "insert" | "delete";
  text: string;
}

export interface NoteVersionDiff {
  fromVersion: number | "current";
  toVersion: number | "current";
  summary: {
    addedBlocks: number;
    removedBlocks: number;
    changedBlocks: number;
    addedWords: number;
    removedWords: number;
  };
  blocks: Array<{
    key: string;
    status: "added" | "removed" | "changed" | "unchanged";
    before?: unknown;
    after?: unknown;
    textDiff?: NoteVersionTextDiffPart[];
  }>;
}

export interface CreateNoteCheckpointResponse {
  created: boolean;
  version: number;
}

export type NoteVersionDiffAgainst = "current" | "previous";

const noteVersionsPath = (noteId: string) =>
  `/notes/${encodeURIComponent(noteId)}/versions`;

export async function listNoteVersions(
  noteId: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<NoteVersionListResponse> {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  const qs = params.toString();
  const json = await apiClient<unknown>(
    `${noteVersionsPath(noteId)}${qs ? `?${qs}` : ""}`,
  );
  return json as NoteVersionListResponse;
}

export async function getNoteVersion(
  noteId: string,
  version: number,
): Promise<NoteVersionDetail> {
  const json = await apiClient<unknown>(
    `${noteVersionsPath(noteId)}/${encodeURIComponent(String(version))}`,
  );
  return json as NoteVersionDetail;
}

export async function getNoteVersionDiff(
  noteId: string,
  version: number,
  against: NoteVersionDiffAgainst = "current",
): Promise<NoteVersionDiff> {
  const json = await apiClient<unknown>(
    `${noteVersionsPath(noteId)}/${encodeURIComponent(String(version))}/diff?against=${encodeURIComponent(against)}`,
  );
  return json as NoteVersionDiff;
}

export function createNoteCheckpoint(
  noteId: string,
  reason?: string,
): Promise<CreateNoteCheckpointResponse> {
  return apiClient<CreateNoteCheckpointResponse>(
    `${noteVersionsPath(noteId)}/checkpoint`,
    {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
}

export async function restoreNoteVersion(
  noteId: string,
  version: number,
): Promise<RestoreNoteVersionResponse> {
  const json = await apiClient<unknown>(
    `${noteVersionsPath(noteId)}/${encodeURIComponent(String(version))}/restore`,
    { method: "POST" },
  );
  return json as RestoreNoteVersionResponse;
}

export interface RestoreNoteVersionResponse {
  noteId: string;
  restoredFromVersion: number;
  newVersion: number;
  updatedAt: string;
}
