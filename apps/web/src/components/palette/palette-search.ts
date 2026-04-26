import { searchApi, type WorkspaceNoteSearchHit } from "@/lib/api-client";

// Thin wrapper — keeps the palette UI ignorant of api-client paths. Returns
// an empty array on any failure (palette should fall back to actions silently
// rather than crashing the dialog).
export async function searchWorkspaceNotes(
  workspaceId: string,
  q: string,
  limit = 20,
): Promise<WorkspaceNoteSearchHit[]> {
  if (!q.trim()) return [];
  try {
    const r = await searchApi.workspaceNotes(workspaceId, q, limit);
    return r.results;
  } catch {
    return [];
  }
}
