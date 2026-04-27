"use client";

import { useState } from "react";
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

  async function search(term: string): Promise<void> {
    setQ(term);
    if (term.length < 2 || !workspaceId) {
      setResults([]);
      return;
    }
    const r = await fetch(
      `/api/search/scope-targets?workspaceId=${workspaceId}&q=${encodeURIComponent(term)}`,
      { credentials: "include" },
    );
    if (r.ok) setResults((await r.json()) as SearchHit[]);
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("add_aria")}
        className="rounded-md border border-dashed border-stone-300 px-1.5 py-0.5 text-stone-500 hover:text-stone-800"
        onClick={() => setOpen(!open)}
      >
        <Plus size={12} />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-64 rounded-md border border-stone-200 bg-white shadow-md">
          <input
            autoFocus
            value={q}
            onChange={(e) => void search(e.target.value)}
            placeholder={t("placeholder")}
            className="w-full border-b border-stone-200 px-2 py-1.5 text-sm outline-none"
          />
          <ul className="max-h-64 overflow-auto">
            {q.length < 2 ? (
              <li className="px-2 py-1 text-xs text-stone-400">
                {t("min_chars_hint")}
              </li>
            ) : results.length === 0 ? (
              <li className="px-2 py-1 text-xs text-stone-400">{t("empty")}</li>
            ) : (
              results.map((r) => (
                <li key={`${r.type}:${r.id}`}>
                  <button
                    type="button"
                    className="w-full px-2 py-1 text-left text-sm hover:bg-stone-50"
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
