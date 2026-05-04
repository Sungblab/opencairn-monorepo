"use client";

import type { AttachedChip } from "@opencairn/shared";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { Brain, Building2, FileText, Folder, Globe2, MessageSquare, X } from "lucide-react";

// Plan 11A — chip rendered inside the chat input. Three concerns:
//   1. Visual icon by chip type (page/project/workspace anchor; memory:l*
//      ride an icon for L3 / L4 / L2).
//   2. Composite key removal (`<type>:<id>`) so the parent ChipRow can
//      pass the same shape the API DELETE endpoint expects.
//   3. Token-estimate tooltip — purely informational; the real per-turn
//      budget lives server-side and is enforced there.
const ICONS: Record<AttachedChip["type"], LucideIcon> = {
  page: FileText,
  project: Folder,
  workspace: Globe2,
  "memory:l3": Brain,
  "memory:l4": Building2,
  "memory:l2": MessageSquare,
};

export function Chip({
  chip,
  onRemove,
  tokenEstimate,
}: {
  chip: AttachedChip;
  onRemove: (key: string) => void;
  tokenEstimate?: number;
}) {
  const t = useTranslations("chatScope.chip");
  const label = chip.label ?? chip.id.slice(0, 8);
  const key = `${chip.type}:${chip.id}`;
  const tooltip =
    tokenEstimate !== undefined
      ? t("tokens_estimate", { kilo: (tokenEstimate / 1000).toFixed(1) })
      : undefined;
  const Icon = ICONS[chip.type];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-[var(--theme-surface)] px-2 py-0.5 text-sm text-foreground"
      title={tooltip}
      data-auto={!chip.manual}
      data-chip-key={key}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
      <span>{label}</span>
      <button
        type="button"
        aria-label={t("remove_aria", { label })}
        className="app-btn-ghost ml-0.5 rounded-[var(--radius-control)] p-0.5 text-muted-foreground"
        onClick={() => onRemove(key)}
      >
        <X size={12} />
      </button>
    </span>
  );
}
