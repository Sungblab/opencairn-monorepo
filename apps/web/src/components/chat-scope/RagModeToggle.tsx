"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Globe, Target } from "lucide-react";

export type RagModeValue = "strict" | "expand";

// Plan 11A — Strict (chips only) vs Expand (chips → fall back to whole
// workspace). Server-side this drives the retrieval layer; client-side it
// is a single dropdown that PATCHes the conversation.
export function RagModeToggle({
  mode,
  onChange,
}: {
  mode: RagModeValue;
  onChange: (m: RagModeValue) => void;
}): JSX.Element {
  const t = useTranslations("chatScope.rag_mode");
  const [open, setOpen] = useState(false);

  const label = mode === "strict" ? t("strict_label") : t("expand_label");
  const Icon = mode === "strict" ? Target : Globe;

  return (
    <div className="relative ml-auto">
      <button
        type="button"
        className="flex items-center gap-1 rounded px-2 py-0.5 text-sm text-stone-700 hover:bg-stone-50"
        onClick={() => setOpen(!open)}
      >
        <Icon size={12} />
        <span>{label}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-stone-200 bg-white shadow-md">
          {(["strict", "expand"] as const).map((m) => {
            const ItemIcon = m === "strict" ? Target : Globe;
            const description =
              m === "strict" ? t("strict_description") : t("expand_description");
            return (
              <button
                key={m}
                type="button"
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-sm hover:bg-stone-50"
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
              >
                <ItemIcon size={12} />
                <span>{description}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
