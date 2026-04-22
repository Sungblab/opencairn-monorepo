import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { NoteEditor } from "@/components/editor/NoteEditor";

interface PageProps {
  params: Promise<{
    locale: string;
    wsSlug: string;
    projectId: string;
    noteId: string;
  }>;
}

interface NoteMetaDTO {
  id: string;
  title: string;
}

interface RoleDTO {
  role: "owner" | "admin" | "editor" | "commenter" | "viewer";
}

interface MeDTO {
  userId: string;
  email: string;
  name?: string | null;
}

export default async function NotePage({ params }: PageProps) {
  const { noteId, wsSlug, projectId } = await params;
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

  // Parallel fan-out — all three endpoints are cheap, independent, and
  // authenticated via the same cookie header.
  //  - /api/notes/:id    → title + metadata (content ignored on client;
  //                        Yjs is canonical — see useCollaborativeEditor).
  //  - /api/notes/:id/role → resolved role for readOnly computation (Task 16).
  //  - /api/auth/me      → current user id + display name for the Yjs
  //                        awareness payload (remote cursor label).
  const [noteRes, roleRes, meRes] = await Promise.all([
    fetch(`${base}/api/notes/${noteId}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetch(`${base}/api/notes/${noteId}/role`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
    fetch(`${base}/api/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    }),
  ]);

  // 403/404 on the note or the role both mean "don't show the editor". The
  // role endpoint returns 403 for role=none (see notes.ts), matching the
  // note endpoint's behavior on the same user.
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

  const note = (await noteRes.json()) as NoteMetaDTO;
  const { role } = (await roleRes.json()) as RoleDTO;
  const me = (await meRes.json()) as MeDTO;

  // viewer + commenter cannot write content or title. owner/admin/editor can.
  const readOnly = role === "viewer" || role === "commenter";
  // Plan 2B Task 18: commenter is readOnly for Yjs but CAN post/resolve/
  // delete comments — decouple the two flags so the CommentsPanel composer
  // appears even when the editor body is locked.
  const canComment = role !== "viewer";

  return (
    <NoteEditor
      noteId={note.id}
      initialTitle={note.title}
      wsSlug={wsSlug}
      projectId={projectId}
      userId={me.userId}
      userName={me.name ?? me.email ?? "Anonymous"}
      readOnly={readOnly}
      canComment={canComment}
    />
  );
}
