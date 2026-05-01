import { locales } from "@/i18n-locales";

// Reverse of urls.ts. Reads URL pathname to structured workspace context.
// Used by useScopeContext and command palette.

export type WorkspacePath = {
  locale: string | null;
  wsSlug: string | null;
  projectId: string | null;
  noteId: string | null;
};

export function parseWorkspacePath(pathname: string): WorkspacePath {
  const clean = pathname.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);

  const out: WorkspacePath = {
    locale: null,
    wsSlug: null,
    projectId: null,
    noteId: null,
  };

  if (parts.length === 0) return out;

  const hasLocale = (locales as readonly string[]).includes(parts[0]!);
  if (hasLocale) {
    out.locale = parts[0]!;
  }

  const workspaceIndex = hasLocale ? 1 : 0;
  if (parts[workspaceIndex] !== "workspace" || !parts[workspaceIndex + 1]) {
    return out;
  }
  out.wsSlug = parts[workspaceIndex + 1]!;

  const rest = parts.slice(workspaceIndex + 2);
  if (rest.length === 0) return out;

  if (rest[0] === "note" && rest[1]) {
    out.noteId = rest[1];
    return out;
  }

  if (rest[0] === "project" && rest[1]) {
    out.projectId = rest[1];
    if (rest[2] === "note" && rest[3]) {
      out.noteId = rest[3];
    }
  }

  return out;
}
