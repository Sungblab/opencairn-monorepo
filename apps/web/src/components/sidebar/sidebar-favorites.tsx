"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  readSidebarFavorites,
  removeSidebarFavorite,
  SIDEBAR_FAVORITES_UPDATED,
  type SidebarFavorite,
} from "./sidebar-favorites-store";
import {
  noteIdFromNoteHref,
  SidebarNoteAiButton,
} from "./sidebar-note-ai-button";

export function SidebarFavorites({ wsSlug }: { wsSlug: string }) {
  const t = useTranslations("sidebar.favorites");
  const [items, setItems] = useState<SidebarFavorite[]>(() =>
    readSidebarFavorites(wsSlug),
  );

  useEffect(() => {
    const refresh = () => setItems(readSidebarFavorites(wsSlug));
    refresh();
    window.addEventListener(SIDEBAR_FAVORITES_UPDATED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SIDEBAR_FAVORITES_UPDATED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [wsSlug]);

  if (items.length === 0) {
    return (
      <div className="rounded-[var(--radius-control)] border border-dashed border-border bg-muted/20 px-2.5 py-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("empty")}
        </p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground/80">
          {t("hint")}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-0.5">
      {items.map((item) => {
        const noteId =
          item.kind === "note"
            ? (item.targetId ?? noteIdFromNoteHref(item.href))
            : null;
        return (
          <div
            key={item.id}
            className="group flex min-h-8 items-center gap-1 rounded-[var(--radius-control)] text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Link
              href={item.href}
              className="min-w-0 flex-1 truncate px-2 py-1.5"
            >
              {item.label}
            </Link>
            {noteId ? (
              <SidebarNoteAiButton
                href={item.href}
                noteId={noteId}
                title={item.label}
              />
            ) : null}
            <button
              type="button"
              aria-label={t("remove")}
              onClick={() => removeSidebarFavorite(wsSlug, item.id)}
              className="mr-1 hidden h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-background hover:text-foreground group-hover:grid focus-visible:grid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
