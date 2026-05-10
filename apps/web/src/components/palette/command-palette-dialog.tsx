"use client";

import { urls } from "@/lib/urls";
import { useEffect, useMemo, useState } from "react";
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
import { useModKeyLabel } from "@/hooks/use-mod-key-label";
import { apiClient, type WorkspaceNoteSearchHit } from "@/lib/api-client";
import { usePaletteStore } from "@/stores/palette-store";
import { extractWsSlug } from "./extract-ws-slug";
import { buildActions } from "./palette-actions";
import { searchWorkspaceNotes } from "./palette-search";

// Loaded only after the lightweight Cmd/Ctrl+K host opens the palette. The
// active workspace is derived from the URL, and the palette degrades gracefully
// on non-workspace routes where note search has no workspace id.
export function CommandPaletteDialog() {
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

  const [notes, setNotes] = useState<WorkspaceNoteSearchHit[]>([]);
  // Debounce so each keystroke doesn't fire a search; 120ms matches the rest
  // of the in-app search UI. Skip the fetch until wsId resolves because an
  // empty workspace id would return 400.
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

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(o: boolean) => (o ? open() : close())}
      title={t("label")}
      description={t("description")}
      className="fixed left-1/2 top-20 z-50 w-[min(680px,calc(100vw-32px))] -translate-x-1/2"
    >
      <Command>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("placeholder")}
          className="w-full bg-transparent px-1 outline-none"
          autoFocus
        />
        <CommandList className="max-h-[420px] overflow-auto">
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
                  className="flex cursor-pointer items-center justify-between"
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
                className="flex cursor-pointer items-center justify-between"
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
