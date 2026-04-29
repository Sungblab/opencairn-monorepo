"use client";
import { useTranslations } from "next-intl";
import { useMermaidRender, mermaidThemeFor } from "@/hooks/useMermaidRender";
import { proseClasses } from "@/lib/markdown/shared-prose";
import { useTheme } from "@/lib/theme/provider";

interface MermaidChatProps {
  code: string;
}

export function MermaidChat({ code }: MermaidChatProps) {
  const t = useTranslations("chat.renderer");
  const { theme } = useTheme();
  const { svg, error, loading } = useMermaidRender(code, mermaidThemeFor(theme));

  if (loading) {
    return (
      <div className={proseClasses.mermaidContainer}>
        <span className="text-xs text-[color:var(--fg-muted)]">
          {t("mermaid_loading")}
        </span>
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="rounded border border-red-400 bg-red-50 p-2 text-xs dark:bg-red-950/30"
        data-testid="mermaid-chat-error"
      >
        <div>{t("mermaid_error")}</div>
        <pre className="mt-1 overflow-x-auto">{code}</pre>
      </div>
    );
  }
  return (
    <div
      className={proseClasses.mermaidContainer}
      data-testid="mermaid-chat"
      dangerouslySetInnerHTML={{ __html: svg ?? "" }}
    />
  );
}
