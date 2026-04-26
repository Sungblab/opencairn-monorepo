"use client";

import { useTranslations } from "next-intl";
import type { NotificationRow } from "@/lib/api-client";

export function NotificationItem({
  item,
  onClick,
}: {
  item: NotificationRow;
  onClick: () => void;
}) {
  const t = useTranslations("notifications.kindLabels");
  // payload schema is loose — we only know `summary` is the user-facing text
  // for the kinds wired up so far (mention). Anything else falls back to a
  // bracketed kind so the drawer item stays informative even for new kinds
  // that haven't shipped a renderer yet.
  const summary =
    typeof item.payload.summary === "string"
      ? item.payload.summary
      : `[${item.kind}]`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col items-start gap-1 rounded border border-border p-2 text-left text-sm transition-colors hover:bg-accent ${
        item.read_at ? "opacity-60" : ""
      }`}
    >
      <span className="text-[10px] uppercase text-muted-foreground">
        {t(item.kind)}
      </span>
      <span className="line-clamp-2 break-words">{summary}</span>
      <span className="text-[10px] text-muted-foreground">
        {new Date(item.created_at).toLocaleString()}
      </span>
    </button>
  );
}
