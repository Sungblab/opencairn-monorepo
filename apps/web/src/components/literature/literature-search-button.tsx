"use client";

// Sidebar icon-rail entry that opens the literature-search modal. Lives
// alongside the rest of the GlobalNav rail (Home / Research / Import).
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
        className="app-hover flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
      >
        <BookText aria-hidden className="h-[15px] w-[15px]" />
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
