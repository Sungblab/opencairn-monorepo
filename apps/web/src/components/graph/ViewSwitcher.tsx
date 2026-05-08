"use client";
import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import type { ViewType } from "@opencairn/shared";

const VIEW_KEYS: ViewType[] = [
  "graph",
  "mindmap",
  "cards",
  "timeline",
  "board",
];

interface Props {
  onAiClick: () => void;
}

export function ViewSwitcher({ onAiClick }: Props) {
  const tViews = useTranslations("graph.views");
  const tAi = useTranslations("graph.ai");
  const router = useRouter();
  const params = useSearchParams();
  const current = (params.get("view") as ViewType | null) ?? "graph";

  function setView(v: ViewType) {
    const next = new URLSearchParams(params.toString());
    next.set("view", v);
    if (v !== "mindmap" && v !== "board") next.delete("root");
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  return (
    <div
      className="flex items-center justify-between border-b px-3 py-2"
      role="group"
      aria-label={tViews("switcherAria")}
    >
      <div className="flex gap-1">
        {VIEW_KEYS.map((v) => (
          <button
            key={v}
            type="button"
            data-active={current === v ? "true" : "false"}
            onClick={() => {
              setView(v);
            }}
            className={
              current === v
                ? "min-h-7 rounded bg-accent px-3 py-1 text-sm font-medium"
                : "min-h-7 rounded px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
            }
          >
            {tViews(v)}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onAiClick}
        className="inline-flex min-h-7 items-center rounded px-2 text-sm text-accent-foreground hover:bg-muted"
      >
        <Bot aria-hidden="true" className="mr-1 inline size-4" />
        {tAi("trigger")}
      </button>
    </div>
  );
}
