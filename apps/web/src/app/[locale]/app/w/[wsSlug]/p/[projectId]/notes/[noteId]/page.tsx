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

export default async function NotePage({ params }: PageProps) {
  const { noteId, wsSlug, projectId } = await params;
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${base}/api/notes/${noteId}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (res.status === 403 || res.status === 404) notFound();
  if (!res.ok) throw new Error(`Failed to load note (${res.status})`);

  const note = (await res.json()) as {
    id: string;
    title: string;
    content: unknown; // jsonb — Plate array or legacy object or null
  };

  // `wsSlug`/`projectId` flow through to the editor so the wiki-link plugin
  // can build correct `/app/w/:ws/p/:project/notes/:id` hrefs.
  return (
    <NoteEditor
      noteId={note.id}
      initialTitle={note.title}
      initialValue={Array.isArray(note.content) ? note.content : null}
      wsSlug={wsSlug}
      projectId={projectId}
    />
  );
}
