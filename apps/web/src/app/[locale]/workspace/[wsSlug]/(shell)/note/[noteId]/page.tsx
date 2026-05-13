import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { NoteRouteClientLoader } from "@/components/notes/NoteRouteClientLoader";

interface PageProps {
  params: Promise<{
    locale: string;
    wsSlug: string;
    noteId: string;
  }>;
}

interface NoteDTO {
  id: string;
  title: string;
  projectId: string;
  workspaceId: string;
  updatedAt: string;
  sourceType: string | null;
  type: string;
  isAuto: boolean;
}

interface RoleDTO {
  role: "owner" | "admin" | "editor" | "commenter" | "viewer";
}

interface MeDTO {
  userId: string;
  email: string;
  name?: string | null;
}

// App Shell Phase 3-B uses this `(shell)/n/[noteId]` route for plate-mode
// notes — TabModeRouter dispatches the other viewer modes (reading/source/
// data/canvas) and skips this page (`isRoutedByTabModeRouter`). The legacy
// `p/[projectId]/notes/[noteId]` route still exists for existing deep
// links + the `not-found` boundary; it stays in sync with this page.
export default async function NotePage({ params }: PageProps) {
  const { noteId, wsSlug } = await params;
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const headers = { cookie: cookieHeader } as const;

  // Parallel fan-out — three cheap, independent reads. Mirrors the legacy
  // p/[projectId]/notes/[noteId]/page.tsx pattern; project name is fetched
  // in a follow-up because we need notes.projectId before we can ask for it.
  const [noteRes, roleRes, meRes] = await Promise.all([
    fetch(`${base}/api/notes/${noteId}`, { headers, cache: "no-store" }),
    fetch(`${base}/api/notes/${noteId}/role`, { headers, cache: "no-store" }),
    fetch(`${base}/api/auth/me`, { headers, cache: "no-store" }),
  ]);

  if (
    noteRes.status === 403 ||
    noteRes.status === 404 ||
    roleRes.status === 403 ||
    roleRes.status === 404
  ) {
    notFound();
  }
  if (!noteRes.ok) throw new Error(`Failed to load note (${noteRes.status})`);
  if (!roleRes.ok) throw new Error(`Failed to load role (${roleRes.status})`);
  if (!meRes.ok) throw new Error(`Failed to load session (${meRes.status})`);

  const note = (await noteRes.json()) as NoteDTO;
  const { role } = (await roleRes.json()) as RoleDTO;
  const me = (await meRes.json()) as MeDTO;

  const readOnly =
    role === "viewer" ||
    role === "commenter" ||
    (note.type === "source" && note.isAuto);
  const canComment = role !== "viewer";

  return (
    <NoteRouteClientLoader
      noteId={note.id}
      title={note.title}
      sourceType={note.sourceType}
      updatedAtIso={note.updatedAt}
      wsSlug={wsSlug}
      workspaceId={note.workspaceId}
      projectId={note.projectId}
      userId={me.userId}
      userName={me.name ?? me.email ?? "Anonymous"}
      readOnly={readOnly}
      canComment={canComment}
    />
  );
}
