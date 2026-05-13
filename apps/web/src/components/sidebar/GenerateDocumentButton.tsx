"use client";

import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";

export function GenerateDocumentButton(_props: {
  wsSlug: string;
  projectId: string;
}) {
  const t = useTranslations("sidebar.nav");
  const requestWorkflow = useAgentWorkbenchStore((s) => s.requestWorkflow);
  const openAgentPanelTab = usePanelStore((s) => s.openAgentPanelTab);

  return (
    <button
      type="button"
      className="inline-flex h-7 w-full items-center justify-start gap-2 rounded-[var(--radius-control)] border border-border bg-background px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="generate-document-button"
      onClick={() => {
        requestWorkflow({
          kind: "document_generation",
          toolId: "pdf_report_fast",
          i18nKey: "pdfReport",
          prompt:
            "현재 프로젝트 자료를 바탕으로 빠르게 공유할 수 있는 PDF 보고서를 만들어줘.",
          presetId: "pdf_report_fast",
        });
        openAgentPanelTab("chat");
      }}
    >
      <FileText aria-hidden className="h-4 w-4" />
      {t("generate_document")}
    </button>
  );
}
