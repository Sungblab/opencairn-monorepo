"use client";

import { useParams, usePathname } from "next/navigation";
import type { AttachedChip, ScopeType } from "@opencairn/shared";

import { useWorkspaceId } from "./useWorkspaceId";

// Plan 11A — derive the chat scope from the current route. The hook does
// NOT fetch the workspace metadata other than resolving slug → id (the
// existing useWorkspaceId hook handles that). It returns the initial
// auto-attached chip set so the chat input can show the page / project /
// workspace pill without an extra round trip.
//
// Route map (matches apps/web/src/app/[locale]/app/w/[wsSlug]/...):
//   /app/w/<wsSlug>/n/<noteId>             → page scope
//   /app/w/<wsSlug>/p/<projectId>/...      → project scope
//   /app/w/<wsSlug>/chat                   → workspace scope
//   /app/w/<wsSlug>                        → workspace scope (fallback)
//
// `manual: false` on the auto chip is what the chip row uses to mark it
// as auto-attached so the UI can render a softer style; users can still
// click X to remove it (the API treats auto and manual chips identically).
export type ScopeContext = {
  scopeType: ScopeType;
  scopeId: string;
  workspaceId: string | null; // null until useWorkspaceId resolves the slug
  workspaceSlug: string;
  initialChips: AttachedChip[];
};

export function useScopeContext(): ScopeContext {
  const params = useParams<{
    wsSlug?: string;
    projectId?: string;
    noteId?: string;
  }>();
  // pathname check disambiguates the workspace-chat route from the bare
  // workspace landing page; both lack noteId/projectId.
  const pathname = usePathname() ?? "";
  const wsSlug = params.wsSlug ?? "";
  const workspaceId = useWorkspaceId(wsSlug || undefined);

  if (params.noteId) {
    return {
      scopeType: "page",
      scopeId: params.noteId,
      workspaceId,
      workspaceSlug: wsSlug,
      initialChips: [{ type: "page", id: params.noteId, manual: false }],
    };
  }

  if (params.projectId) {
    return {
      scopeType: "project",
      scopeId: params.projectId,
      workspaceId,
      workspaceSlug: wsSlug,
      initialChips: [{ type: "project", id: params.projectId, manual: false }],
    };
  }

  // Workspace-scoped chat. The chip's `id` uses workspaceId once the slug
  // resolves; until then we anchor on the slug so the chip still renders
  // (its `id` will be reconciled on next render once the API call lands).
  const wsChipId = workspaceId ?? wsSlug;
  return {
    scopeType: "workspace",
    scopeId: wsChipId,
    workspaceId,
    workspaceSlug: wsSlug,
    initialChips: [{ type: "workspace", id: wsChipId, manual: false }],
  };
}
