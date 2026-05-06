"use client";

import { urls } from "@/lib/urls";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { usePaletteStore } from "@/stores/palette-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useModKeyLabel } from "@/hooks/use-mod-key-label";
import { apiClient, type WorkspaceNoteSearchHit } from "@/lib/api-client";
import { buildActions } from "./palette-actions";
import { searchWorkspaceNotes } from "./palette-search";
import { extractWsSlug } from "./extract-ws-slug";

// Mounted at the [locale]/layout boundary so /settings, /onboarding, and the
// rest of the non-shell routes pick up Cmd/Ctrl+K too. The active workspace is
// derived from the URL — we only have a wsSlug under `/<locale>/workspace/<slug>`
// — and the palette degrades gracefully (action-only, no note search) when
// the path doesn't have one.
//
// wsId is resolved on demand via /workspaces/by-slug/:slug — react-query
// dedupes against the same fetch the sidebar made on mount, so this adds no
// extra round-trip in the common case.
export function CommandPalette() {
  const pathname = usePathname();
  const wsSlug = extractWsSlug(pathname);
  const { data: ws } = useQuery({
    queryKey: ["ws-by-slug", wsSlug],
    queryFn: () => apiClient<{ id: string }>(`/workspaces/by-slug/${wsSlug}`),
    enabled: !!wsSlug,
  });
  const wsId = ws?.id ?? "";
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("palette");
  const tActions = useTranslations("palette.actions");
  const modKeyLabel = useModKeyLabel();

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
    () => buildActions({ locale, wsSlug: wsSlug ?? undefined }),
    [locale, wsSlug],
  );

  if (!isOpen) return null;

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(o: boolean) => (o ? open() : close())}
      title={t("label")}
      description={t("description")}
      className="fixed left-1/2 top-20 z-50 w-[520px] -translate-x-1/2 border-2 border-border bg-background"
    >
      <Command>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("placeholder")}
          className="w-full bg-transparent px-1 text-sm outline-none"
          autoFocus
        />
        <CommandList className="max-h-80 overflow-auto">
          <CommandEmpty className="p-4 text-left text-xs text-muted-foreground">
            {t("empty")}
          </CommandEmpty>
          {notes.length > 0 && wsSlug && (
            <CommandGroup heading={t("groups.notes")}>
              {notes.map((n) => (
                <CommandItem
                  key={n.id}
                  value={`note-${n.id}-${n.title}`}
                  onSelect={() => {
                    router.push(urls.workspace.note(locale, wsSlug, n.id));
                    close();
                  }}
                  className="flex min-h-8 cursor-pointer items-center justify-between px-2 py-1.5 text-sm"
                >
                  <span className="truncate">{n.title}</span>
                  <span className="ml-3 shrink-0 text-[10px] text-muted-foreground">
                    {n.project_name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading={t("groups.actions")}>
            {actions.map((a) => (
              <CommandItem
                key={a.id}
                value={`action-${a.id}-${tActions(a.labelKey)}`}
                onSelect={() => {
                  a.run(router);
                  close();
                }}
                  className="flex min-h-8 cursor-pointer items-center justify-between px-2 py-1.5 text-sm"
              >
                <span>{tActions(a.labelKey)}</span>
                {a.shortcut ? (
                  <kbd className="border border-border px-1 text-[10px] text-muted-foreground">
                    {a.shortcut
                      .map((part) => (part === "mod" ? modKeyLabel : part))
                      .join("+")}
                  </kbd>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
