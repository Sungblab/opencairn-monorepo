"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import type { AttachedChip } from "@opencairn/shared";

type SearchHit = {
  type: AttachedChip["type"];
  id: string;
  label: string;
};

// Plan 11A — chip combobox. Backed by GET /api/search/scope-targets which
// returns visible pages + projects in the current workspace. The minimum
// query length matches the server-side validation so the UI never fires
// a request that will 400.
export function AddChipCombobox({
  workspaceId,
  onAdd,
}: {
  workspaceId: string | null;
  onAdd: (chip: { type: AttachedChip["type"]; id: string }) => void;
}) {
  const t = useTranslations("chatScope.combobox");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  // AbortController per in-flight search. Without this, a slow
  // response for "ro" can clobber a fresh "rop" response that
  // resolved earlier — the user sees stale results that don't
  // match what they typed.
  const inflight = useRef<AbortController | null>(null);

  // Cancel any pending request on unmount so React doesn't try to
  // setState on a torn-down component.
  useEffect(
    () => () => {
      inflight.current?.abort();
    },
    [],
  );

  async function search(term: string): Promise<void> {
    setQ(term);
    if (term.length < 2 || !workspaceId) {
      setResults([]);
      inflight.current?.abort();
      inflight.current = null;
      return;
    }
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const r = await fetch(
        `/api/search/scope-targets?workspaceId=${workspaceId}&q=${encodeURIComponent(term)}`,
        { credentials: "include", signal: ctrl.signal },
      );
      if (ctrl.signal.aborted) return;
      if (r.ok) setResults((await r.json()) as SearchHit[]);
    } catch (e) {
      // AbortError is the expected signal that a newer search
      // pre-empted us — swallow it; anything else bubbles up.
      if ((e as { name?: string }).name !== "AbortError") throw e;
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("add_aria")}
        className="app-hover rounded-[var(--radius-control)] border border-dashed border-border px-1.5 py-0.5 text-muted-foreground"
        onClick={() => setOpen(!open)}
      >
        <Plus size={12} />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-64 rounded-[var(--radius-card)] border border-border bg-background shadow-md">
          <input
            autoFocus
            value={q}
            onChange={(e) => void search(e.target.value)}
            placeholder={t("placeholder")}
            className="w-full border-b border-border bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <ul className="max-h-64 overflow-auto">
            {q.length < 2 ? (
              <li className="px-2 py-1 text-xs text-muted-foreground">
                {t("min_chars_hint")}
              </li>
            ) : results.length === 0 ? (
              <li className="px-2 py-1 text-xs text-muted-foreground">{t("empty")}</li>
            ) : (
              results.map((r) => (
                <li key={`${r.type}:${r.id}`}>
                  <button
                    type="button"
                    className="app-hover w-full px-2 py-1 text-left text-sm"
                    onClick={() => {
                      onAdd({ type: r.type, id: r.id });
                      setOpen(false);
                      setQ("");
                      setResults([]);
                    }}
                  >
                    {r.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
