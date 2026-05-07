"use client";

// Sidebar navigation entry that opens the literature-search modal.
//
// Resolves workspaceId from the wsSlug prop via useWorkspaceId so the modal
// can call /api/literature/search without prop-drilling. The current
// projectId (if any) becomes the default destination so a user already in a
// project skips the picker step.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BookText } from "lucide-react";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { useCurrentProjectContext } from "@/components/sidebar/use-current-project";
import { LiteratureSearchModal } from "./literature-search-modal";

export interface LiteratureSearchButtonProps {
  wsSlug: string;
}

export function LiteratureSearchButton({
  wsSlug,
}: LiteratureSearchButtonProps) {
  const t = useTranslations("sidebar.nav");
  const [open, setOpen] = useState(false);
  const workspaceId = useWorkspaceId(wsSlug);
  const { projectId } = useCurrentProjectContext();
  const label = t("literature");

  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => setOpen(true)}
        data-testid="sidebar-literature-button"
        className="flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookText aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      <LiteratureSearchModal
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId}
        defaultProjectId={projectId}
      />
    </>
  );
}
