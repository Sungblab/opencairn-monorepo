"use client";

import { NoteEditorClient } from "@/components/editor/note-editor-client";
import { NoteRouteChrome } from "./NoteRouteChrome";
import { NoteTabModeSync } from "./NoteTabModeSync";
import { NoteWithBacklinks } from "./NoteWithBacklinks";

export type NoteRouteClientProps = {
  noteId: string;
  title: string;
  sourceType: string | null;
  updatedAtIso: string;
  wsSlug: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  userName: string;
  readOnly: boolean;
  canComment: boolean;
};

export function NoteRouteClient({
  noteId,
  title,
  sourceType,
  updatedAtIso,
  wsSlug,
  workspaceId,
  projectId,
  userId,
  userName,
  readOnly,
  canComment,
}: NoteRouteClientProps) {
  return (
    <NoteWithBacklinks noteId={noteId}>
      <NoteTabModeSync noteId={noteId} sourceType={sourceType} />
      <NoteRouteChrome
        noteId={noteId}
        readOnly={readOnly}
        wsSlug={wsSlug}
        projectId={projectId}
        projectName={null}
        title={title}
        updatedAtIso={updatedAtIso}
      />
      <NoteEditorClient
        noteId={noteId}
        initialTitle={title}
        wsSlug={wsSlug}
        workspaceId={workspaceId}
        projectId={projectId}
        userId={userId}
        userName={userName}
        readOnly={readOnly}
        canComment={canComment}
      />
    </NoteWithBacklinks>
  );
}
