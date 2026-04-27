"use client";

import type { AttachedChip } from "@opencairn/shared";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

// Plan 11A — chip pill rendered inside the chat input. Three concerns:
//   1. Visual icon by chip type (page/project/workspace anchor; memory:l*
//      ride a brain glyph for L3 / building for L4 / chat bubble for L2).
//   2. Composite key removal (`<type>:<id>`) so the parent ChipRow can
//      pass the same shape the API DELETE endpoint expects.
//   3. Token-estimate tooltip — purely informational; the real per-turn
//      budget lives server-side and is enforced there.
const ICONS: Record<AttachedChip["type"], string> = {
  page: "📄",
  project: "📂",
  workspace: "🌐",
  "memory:l3": "🧠",
  "memory:l4": "🏢",
  "memory:l2": "💬",
};

export function Chip({
  chip,
  onRemove,
  tokenEstimate,
}: {
  chip: AttachedChip;
  onRemove: (key: string) => void;
  tokenEstimate?: number;
}): JSX.Element {
  const t = useTranslations("chatScope.chip");
  const label = chip.label ?? chip.id.slice(0, 8);
  const key = `${chip.type}:${chip.id}`;
  const tooltip =
    tokenEstimate !== undefined
      ? t("tokens_estimate", { kilo: (tokenEstimate / 1000).toFixed(1) })
      : undefined;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-stone-100 px-2 py-0.5 text-sm text-stone-800"
      title={tooltip}
      data-auto={!chip.manual}
      data-chip-key={key}
    >
      <span aria-hidden>{ICONS[chip.type]}</span>
      <span>{label}</span>
      <button
        type="button"
        aria-label={t("remove_aria", { label })}
        className="ml-1 text-stone-400 hover:text-stone-700"
        onClick={() => onRemove(key)}
      >
        <X size={12} />
      </button>
    </span>
  );
}
