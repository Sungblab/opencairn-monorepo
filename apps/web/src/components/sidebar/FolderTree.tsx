"use client";
import { useState } from "react";
import { ChevronRight, ChevronDown, Folder } from "lucide-react";
import type { FolderRow, NoteRow } from "@/lib/api-client";
import { NoteList } from "./NoteList";

export function FolderTree({
  folders,
  notes,
  workspaceSlug,
  projectId,
}: {
  folders: FolderRow[];
  notes: NoteRow[];
  workspaceSlug: string;
  projectId: string;
}) {
  const byParent = new Map<string | null, FolderRow[]>();
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }

  const notesByFolder = new Map<string | null, NoteRow[]>();
  for (const n of notes) {
    const list = notesByFolder.get(n.folderId) ?? [];
    list.push(n);
    notesByFolder.set(n.folderId, list);
  }

  return (
    <Branch
      parentId={null}
      byParent={byParent}
      notesByFolder={notesByFolder}
      workspaceSlug={workspaceSlug}
      projectId={projectId}
    />
  );
}

function Branch({
  parentId,
  byParent,
  notesByFolder,
  workspaceSlug,
  projectId,
}: {
  parentId: string | null;
  byParent: Map<string | null, FolderRow[]>;
  notesByFolder: Map<string | null, NoteRow[]>;
  workspaceSlug: string;
  projectId: string;
}) {
  const folders = byParent.get(parentId) ?? [];
  const rootNotes = parentId === null ? (notesByFolder.get(null) ?? []) : [];
  return (
    <div className="space-y-1">
      {rootNotes.length > 0 && (
        <NoteList
          notes={rootNotes}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
        />
      )}
      {folders.map((f) => (
        <FolderNode
          key={f.id}
          folder={f}
          byParent={byParent}
          notesByFolder={notesByFolder}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
        />
      ))}
    </div>
  );
}

function FolderNode({
  folder,
  byParent,
  notesByFolder,
  workspaceSlug,
  projectId,
}: {
  folder: FolderRow;
  byParent: Map<string | null, FolderRow[]>;
  notesByFolder: Map<string | null, NoteRow[]>;
  workspaceSlug: string;
  projectId: string;
}) {
  const [open, setOpen] = useState(true);
  const childFolders = byParent.get(folder.id) ?? [];
  const folderNotes = notesByFolder.get(folder.id) ?? [];
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full px-1.5 py-0.5 text-xs font-medium text-fg-muted hover:text-fg"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Folder className="h-3 w-3" />
        <span className="truncate">{folder.name}</span>
      </button>
      {open && (
        <div className="ml-3 mt-0.5 space-y-1">
          {folderNotes.length > 0 && (
            <NoteList
              notes={folderNotes}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
            />
          )}
          {childFolders.length > 0 && (
            <Branch
              parentId={folder.id}
              byParent={byParent}
              notesByFolder={notesByFolder}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
            />
          )}
        </div>
      )}
    </div>
  );
}
