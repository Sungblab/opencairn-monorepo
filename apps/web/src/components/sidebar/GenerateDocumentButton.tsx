"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { urls } from "@/lib/urls";

export function GenerateDocumentButton({
  wsSlug,
  projectId,
}: {
  wsSlug: string;
  projectId: string;
}) {
  const locale = useLocale();
  const t = useTranslations("sidebar.nav");

  return (
    <Link
      href={`${urls.workspace.synthesisExport(locale, wsSlug)}?project=${projectId}`}
      className="inline-flex h-7 w-full items-center justify-start gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="generate-document-button"
    >
      <FileText aria-hidden className="h-4 w-4" />
      {t("generate_document")}
    </Link>
  );
}
