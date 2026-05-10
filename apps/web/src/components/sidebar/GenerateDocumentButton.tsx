"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { WorkbenchActivityButton } from "@/components/agent-panel/workbench-trigger-button";

export function GenerateDocumentButton(_props: {
  wsSlug: string;
  projectId: string;
}) {
  const t = useTranslations("sidebar.nav");

  return (
    <WorkbenchActivityButton
      className="inline-flex h-7 w-full items-center justify-start gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="generate-document-button"
    >
      <FileText aria-hidden className="h-4 w-4" />
      {t("generate_document")}
    </WorkbenchActivityButton>
  );
}
