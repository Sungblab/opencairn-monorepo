"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { meApi } from "@/lib/api-client";

export function ProfileView() {
  const t = useTranslations("account.profile");
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["me"], queryFn: () => meApi.get() });
  const [name, setName] = useState("");

  // Hydrate the input once the server response lands. Re-syncs if the user
  // navigates away and back to a freshly fetched profile.
  useEffect(() => {
    if (data?.name && name === "") setName(data.name);
  }, [data?.name, name]);

  const save = useMutation({
    mutationFn: () => meApi.patch({ name: name.trim() }),
    onSuccess: () => {
      toast.success(t("saved"));
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: () => toast.error(t("saveFailed")),
  });

  if (!data) return null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save.mutate();
      }}
      className="flex max-w-md flex-col gap-4"
    >
      <h1 className="text-xl font-semibold">{t("heading")}</h1>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("nameLabel")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-border bg-transparent px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("emailLabel")}</span>
        <input
          value={data.email}
          readOnly
          className="rounded border border-border bg-muted/30 px-2 py-1 text-muted-foreground"
        />
      </label>
      <p className="text-xs text-muted-foreground">{t("localeNote")}</p>
      <button
        type="submit"
        disabled={save.isPending || !name.trim()}
        className="self-start rounded bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
      >
        {t("save")}
      </button>
    </form>
  );
}
