"use client";

// Context-scope chip strip below the composer. The user toggles which
// surfaces the agent is allowed to see (page/project/workspace/memory/
// current research) plus a STRICT vs LOOSE switch that decides whether
// off-scope retrieval is hard-blocked or merely down-weighted.
//
// `defaultScopeIds` is exported separately so the AgentPanel caller can
// derive the *initial* selection from the active tab kind without
// re-reading the store inside this component on every render. This row
// itself stays stateless beyond the props — caller owns selection +
// strict mode.

import { useTranslations } from "next-intl";

import { useTabsStore } from "@/stores/tabs-store";

export type ScopeKind =
  | "page"
  | "project"
  | "workspace"
  | "memory"
  | "research";

export interface Scope {
  id: string;
  kind: ScopeKind;
}

function defaultScopeIds(activeKind: string | undefined): string[] {
  // Map active tab kind → default scope chips. Chosen so the agent's
  // "what does this thread know about?" defaults match where the user is
  // currently looking — note tabs prepopulate page+project, research tabs
  // prepopulate the research itself, etc. Anything else (dashboard,
  // import, settings, research_hub) falls back to workspace-wide context.
  switch (activeKind) {
    case "note":
      return ["page", "project"];
    case "project":
      return ["project"];
    case "research_run":
      return ["research"];
    default:
      return ["workspace"];
  }
}

interface Props {
  selected: string[];
  onChange(next: string[]): void;
  strict: "strict" | "loose";
  onStrictChange(v: "strict" | "loose"): void;
}

const ALL_KINDS: ScopeKind[] = [
  "page",
  "project",
  "workspace",
  "memory",
  "research",
];

export function ScopeChipsRow({
  selected,
  onChange,
  strict,
  onStrictChange,
}: Props) {
  const t = useTranslations("agentPanel.scope");
  const activeId = useTabsStore((s) => s.activeId);
  const tab = useTabsStore((s) => s.tabs.find((tt) => tt.id === activeId));
  // Chips offered: a stable union so the user can promote any context, not
  // only the kinds defaulted by the active tab. The active tab is read
  // here purely for future suggestion logic — today the AgentPanel caller
  // seeds the initial selection from `defaultScopeIds`, which keeps this
  // component a pure controlled view.
  void tab;
  return (
    <div className="flex items-center gap-1 border-t border-border px-2 py-1 text-[10px]">
      <div className="flex flex-1 flex-wrap gap-1">
        {ALL_KINDS.map((kind) => {
          const on = selected.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() =>
                onChange(
                  on
                    ? selected.filter((x) => x !== kind)
                    : [...selected, kind],
                )
              }
              className={`rounded border px-2 py-0.5 ${on ? "border-foreground" : "border-border"}`}
            >
              {t(`chips.${kind}`)}
            </button>
          );
        })}
        <button
          type="button"
          aria-label={t("add_aria")}
          className="rounded border border-dashed border-border px-2 py-0.5 text-muted-foreground"
        >
          +
        </button>
      </div>
      <button
        type="button"
        aria-label={t("strict_aria")}
        onClick={() => onStrictChange(strict === "strict" ? "loose" : "strict")}
        className="rounded border border-border px-2 py-0.5 uppercase"
      >
        {t(strict)}
      </button>
    </div>
  );
}

export { defaultScopeIds };
