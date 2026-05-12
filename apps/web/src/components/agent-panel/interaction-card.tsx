"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

export type AgentInteractionCardAction = {
  type: "create_note_draft";
  title?: string;
  body?: string;
};

export type AgentInteractionCardOption = {
  id: string;
  label: string;
  value: string;
  action?: AgentInteractionCardAction;
};

export type AgentInteractionCard = {
  type: "choice";
  id: string;
  prompt: string;
  options: AgentInteractionCardOption[];
  allowCustom?: boolean;
  answered?: {
    value: string;
    label?: string;
    messageId?: string;
  };
};

export type InteractionCardSubmit = {
  card: AgentInteractionCard;
  option: AgentInteractionCardOption | null;
  value: string;
  label: string;
};

export function isAgentInteractionCard(
  value: unknown,
): value is AgentInteractionCard {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type !== "choice") return false;
  if (typeof record.id !== "string" || typeof record.prompt !== "string") {
    return false;
  }
  if (!Array.isArray(record.options)) return false;
  return record.options.every((option) => {
    if (!option || typeof option !== "object") return false;
    const item = option as Record<string, unknown>;
    return (
      typeof item.id === "string" &&
      typeof item.label === "string" &&
      typeof item.value === "string"
    );
  });
}

export function InteractionCard({
  card,
  onSubmit,
}: {
  card: AgentInteractionCard;
  onSubmit(input: InteractionCardSubmit): void;
}) {
  const t = useTranslations("agentPanel.interactionCard");
  const [customValue, setCustomValue] = useState("");
  const answeredLabel = card.answered?.label ?? card.answered?.value;

  if (answeredLabel) {
    return (
      <div className="rounded-[var(--radius-card)] border border-border bg-muted/25 px-3 py-2 text-sm">
        <p className="text-xs font-medium text-muted-foreground">
          {card.prompt}
        </p>
        <p className="mt-2 inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-background px-2 py-1 text-xs font-medium text-foreground">
          <Check aria-hidden className="h-3.5 w-3.5" />
          {t("answered", { label: answeredLabel })}
        </p>
      </div>
    );
  }

  function submitOption(option: AgentInteractionCardOption) {
    onSubmit({
      card,
      option,
      value: option.value,
      label: option.label,
    });
  }

  function submitCustom() {
    const value = customValue.trim();
    if (!value) return;
    onSubmit({ card, option: null, value, label: value });
    setCustomValue("");
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-muted/20 px-3 py-2 text-sm">
      <p className="font-medium text-foreground">{card.prompt}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {card.options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => submitOption(option)}
            className="rounded-[var(--radius-control)] border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/45 hover:bg-primary/10"
          >
            {option.label}
          </button>
        ))}
      </div>
      {card.allowCustom ? (
        <div className="mt-2 flex gap-1.5">
          <input
            aria-label={t("customInput")}
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitCustom();
              }
            }}
            className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground"
          />
          <button
            type="button"
            onClick={submitCustom}
            disabled={!customValue.trim()}
            className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {t("customSubmit")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
