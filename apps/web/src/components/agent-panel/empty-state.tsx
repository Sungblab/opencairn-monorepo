import { useTranslations } from "next-intl";

type SuggestionId = "summarize" | "keyPoints" | "questions" | "related";

const suggestionIds: SuggestionId[] = [
  "summarize",
  "keyPoints",
  "questions",
  "related",
];

export function AgentPanelEmptyState({
  hasContext,
  onSuggestion,
}: {
  hasContext?: boolean;
  onSuggestion?(prompt: string): void;
}) {
  const t = useTranslations("agentPanel.empty_state");

  return (
    <div className="flex flex-1 flex-col justify-center bg-background px-4 pb-[clamp(5rem,18vh,10rem)] pt-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {t(hasContext ? "title_with_context" : "title")}
          </p>
          <p className="max-w-[28rem] text-xs leading-5 text-muted-foreground">
            {t(hasContext ? "intro_with_context" : "intro")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {suggestionIds.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onSuggestion?.(t(`suggestions.${id}.prompt`))}
              className="min-h-8 rounded-[var(--radius-control)] border border-border bg-muted/20 px-2.5 text-xs font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-muted/40"
            >
              {t(`suggestions.${id}.label`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
