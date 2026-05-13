"use client";

import { Check, Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export function ProjectMetaRow({
  name,
  pageCount,
  lastActivityIso,
  onRename,
  renamePending = false,
}: {
  name: string;
  pageCount: number;
  lastActivityIso: string | null;
  onRename?: (name: string) => void;
  renamePending?: boolean;
}) {
  const t = useTranslations("project.metaRow");
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);

  useEffect(() => {
    if (!editing) setDraftName(name);
  }, [editing, name]);

  const trimmedName = draftName.trim();

  function save() {
    if (!trimmedName || trimmedName === name || renamePending) {
      setEditing(false);
      setDraftName(name);
      return;
    }
    onRename?.(trimmedName);
    setEditing(false);
  }

  // Format the timestamp on the client so we honour the user's locale +
  // timezone without paying for a server roundtrip per render. `null` only
  // happens when the project has zero notes — surface a dedicated copy so
  // empty states don't read as "Last active --".
  const lastActivity = lastActivityIso
    ? new Date(lastActivityIso).toLocaleString()
    : null;
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        {editing ? (
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
              if (event.key === "Escape") {
                setEditing(false);
                setDraftName(name);
              }
            }}
            autoFocus
            maxLength={100}
            className="min-h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-background px-2 text-2xl font-semibold tracking-tight outline-none focus:border-foreground focus:ring-2 focus:ring-ring"
            aria-label={t("renameInput")}
          />
        ) : (
          <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
        )}
        {editing ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={save}
              disabled={!trimmedName || renamePending}
              aria-label={t("renameSave")}
              className="grid size-8 place-items-center rounded-[var(--radius-control)] border border-border bg-background text-muted-foreground transition hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraftName(name);
              }}
              aria-label={t("renameCancel")}
              className="grid size-8 place-items-center rounded-[var(--radius-control)] border border-border bg-background text-muted-foreground transition hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-4" />
            </button>
          </span>
        ) : onRename ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={t("rename")}
            className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-transparent text-muted-foreground transition hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pencil aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("pageCount", { n: pageCount })}
        {" · "}
        {lastActivity
          ? t("lastActivity", { at: lastActivity })
          : t("lastActivityNever")}
      </p>
    </div>
  );
}
