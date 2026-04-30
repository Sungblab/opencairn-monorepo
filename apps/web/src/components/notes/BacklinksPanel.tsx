"use client";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import type { BacklinksResponse } from "@opencairn/shared";
import { useTabsStore } from "@/stores/tabs-store";

interface Props {
  noteId: string;
}

export function BacklinksPanel({ noteId }: Props) {
  const t = useTranslations("note.backlinks");
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ wsSlug: string }>();
  const wsSlug = params?.wsSlug;
  const addOrReplacePreview = useTabsStore((s) => s.addOrReplacePreview);

  const { data } = useQuery<BacklinksResponse>({
    queryKey: ["backlinks", noteId],
    enabled: !!noteId,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/notes/${noteId}/backlinks`);
      if (!res.ok) throw new Error(`backlinks ${res.status}`);
      return (await res.json()) as BacklinksResponse;
    },
  });

  function open(b: BacklinksResponse["data"][number]) {
    addOrReplacePreview({
      id: crypto.randomUUID(),
      kind: "note",
      targetId: b.id,
      mode: "plate",
      title: b.title,
      pinned: false,
      preview: true,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    });
    if (!wsSlug) return;
    router.push(`/${locale}/app/w/${wsSlug}/n/${b.id}`);
  }

  return (
    <aside
      aria-label={t("toggleAria")}
      className="flex h-full w-72 flex-col gap-2 overflow-y-auto border-l border-border bg-background p-3"
    >
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <span
          className="text-xs text-muted-foreground"
          aria-label={t("countAria", { count: data?.total ?? 0 })}
        >
          {data?.total ?? 0}
        </span>
      </header>
      {data && data.total === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {data?.data.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => open(b)}
                className="w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                {b.title}
                <span className="ml-2 text-xs text-muted-foreground">
                  {b.projectName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
