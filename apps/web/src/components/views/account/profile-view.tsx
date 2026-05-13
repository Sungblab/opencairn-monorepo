"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { meApi } from "@/lib/api-client";

export function ProfileView() {
  const t = useTranslations("account.profile");
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["me"], queryFn: () => meApi.get() });
  const [name, setName] = useState("");

  // Hydrate the input once per fetched user — gating on `name === ""` made
  // the field uneditable (clearing the input snapped it back to data.name on
  // the next render). Track the last hydrated user id so a logout/relogin or
  // account switch still re-syncs.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (data && hydratedFor.current !== data.id) {
      setName(data.name ?? "");
      hydratedFor.current = data.id;
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => meApi.patch({ name: name.trim() }),
    onSuccess: () => {
      toast.success(t("saved"));
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: () => toast.error(t("saveFailed")),
  });

  if (!data) {
    return (
      <section className="max-w-3xl space-y-5">
        <div className="h-8 w-36 rounded-[var(--radius-control)] bg-muted" />
        <div className="h-56 rounded-[var(--radius-card)] border border-border bg-background" />
      </section>
    );
  }
  return (
    <section className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">{t("heading")}</h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save.mutate();
        }}
        className="rounded-[var(--radius-card)] border border-border bg-background shadow-sm"
      >
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <h2 className="text-sm font-semibold">{t("heading")}</h2>
        </div>
        <div className="grid gap-4 px-4 py-5 sm:px-5 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              {t("nameLabel")}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-10 rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-foreground"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              {t("emailLabel")}
            </span>
            <input
              value={data.email}
              readOnly
              className="min-h-10 rounded-[var(--radius-control)] border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
            />
          </label>
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-xs text-muted-foreground">{t("localeNote")}</p>
          <button
            type="submit"
            disabled={save.isPending || !name.trim()}
            className="app-btn-primary min-h-10 rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium disabled:opacity-50 sm:self-start"
          >
            {t("save")}
          </button>
        </div>
      </form>
    </section>
  );
}
