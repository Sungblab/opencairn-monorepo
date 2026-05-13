"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { THEME_LABELS } from "@/lib/theme/themes";
import { useTheme } from "@/lib/theme/provider";

export function AppearanceView() {
  const t = useTranslations("account.appearance");
  const { theme, themes, setTheme } = useTheme();

  return (
    <section className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">{t("heading")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {themes.map((id) => {
          const active = id === theme;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              aria-pressed={active}
              className={`flex min-h-28 items-start justify-between rounded-[var(--radius-card)] border p-4 text-left shadow-sm transition-colors ${
                active
                  ? "border-foreground/20 bg-foreground text-background"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              <span>
                <span className="block text-sm font-semibold">
                  {THEME_LABELS[id]}
                </span>
                <span
                  className={`mt-1 block text-xs ${
                    active ? "text-background/75" : "text-muted-foreground"
                  }`}
                >
                  {t(`themes.${id}`)}
                </span>
              </span>
              {active && <Check aria-hidden className="h-4 w-4 shrink-0" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
