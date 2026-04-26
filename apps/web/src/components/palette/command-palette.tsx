"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { usePaletteStore } from "@/stores/palette-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { apiClient, type WorkspaceNoteSearchHit } from "@/lib/api-client";
import { buildActions } from "./palette-actions";
import { searchWorkspaceNotes } from "./palette-search";

// Mounted by ShellProviders so it has the wsSlug context. ⌘K opens; ⌘\\ /
// ⌘J still toggle their panels even with the palette open because the store
// dispatches don't depend on focus.
//
// wsId is resolved on demand via /workspaces/by-slug/:slug — react-query
// dedupes against the same fetch the sidebar made on mount, so this adds no
// extra round-trip in the common case.
export function CommandPalette({ wsSlug }: { wsSlug: string }) {
  const { data: ws } = useQuery({
    queryKey: ["ws-by-slug", wsSlug],
    queryFn: () => apiClient<{ id: string }>(`/workspaces/by-slug/${wsSlug}`),
  });
  const wsId = ws?.id ?? "";
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("palette");
  const tActions = useTranslations("palette.actions");

  const isOpen = usePaletteStore((s) => s.isOpen);
  const open = usePaletteStore((s) => s.open);
  const close = usePaletteStore((s) => s.close);
  const query = usePaletteStore((s) => s.query);
  const setQuery = usePaletteStore((s) => s.setQuery);

  const onShortcut = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      open();
    },
    [open],
  );
  useKeyboardShortcut("mod+k", onShortcut);

  const [notes, setNotes] = useState<WorkspaceNoteSearchHit[]>([]);
  // Debounce so each keystroke doesn't fire a search; 120ms matches the rest
  // of the in-app search UI (note search box). Skip the fetch entirely until
  // wsId resolves — a search with empty wsId returns 400.
  useEffect(() => {
    if (!isOpen || !wsId) {
      setNotes([]);
      return;
    }
    const id = setTimeout(async () => {
      setNotes(await searchWorkspaceNotes(wsId, query));
    }, 120);
    return () => clearTimeout(id);
  }, [query, isOpen, wsId]);

  const actions = useMemo(
    () => buildActions({ locale, wsSlug }),
    [locale, wsSlug],
  );

  if (!isOpen) return null;

  return (
    <Command.Dialog
      open={isOpen}
      onOpenChange={(o: boolean) => (o ? open() : close())}
      label={t("label")}
      className="fixed left-1/2 top-20 z-50 w-[520px] -translate-x-1/2 rounded-lg border border-border bg-background shadow-lg"
    >
      <Command.Input
        value={query}
        onValueChange={setQuery}
        placeholder={t("placeholder")}
        className="w-full border-b border-border bg-transparent px-3 py-3 text-sm outline-none"
        autoFocus
      />
      <Command.List className="max-h-80 overflow-auto p-1">
        <Command.Empty className="p-3 text-xs text-muted-foreground">
          {t("empty")}
        </Command.Empty>
        {notes.length > 0 && (
          <Command.Group heading={t("groups.notes")}>
            {notes.map((n) => (
              <Command.Item
                key={n.id}
                value={`note-${n.id}-${n.title}`}
                onSelect={() => {
                  router.push(`/${locale}/app/w/${wsSlug}/n/${n.id}`);
                  close();
                }}
                className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm aria-selected:bg-accent"
              >
                <span className="truncate">{n.title}</span>
                <span className="ml-3 shrink-0 text-[10px] text-muted-foreground">
                  {n.project_name}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading={t("groups.actions")}>
          {actions.map((a) => (
            <Command.Item
              key={a.id}
              value={`action-${a.id}-${tActions(a.labelKey)}`}
              onSelect={() => {
                a.run(router);
                close();
              }}
              className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm aria-selected:bg-accent"
            >
              <span>{tActions(a.labelKey)}</span>
              {a.shortcut ? (
                <kbd className="text-[10px] text-muted-foreground">
                  {a.shortcut}
                </kbd>
              ) : null}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
