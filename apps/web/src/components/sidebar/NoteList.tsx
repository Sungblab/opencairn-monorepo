"use client";
import { urls } from "@/lib/urls";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { NoteRow } from "@/lib/api-client";

export function NoteList({
  notes,
  workspaceSlug,
  projectId,
}: {
  notes: NoteRow[];
  workspaceSlug: string;
  projectId: string;
}) {
  const locale = useLocale();
  const t = useTranslations("sidebar");
  const path = usePathname();
  return (
    <ul className="space-y-0.5">
      {notes.map((n) => {
        const href = urls.workspace.projectNote(locale, workspaceSlug, projectId, n.id);
        const active = path?.endsWith(`/note/${n.id}`);
        return (
          <li key={n.id}>
            <Link
              href={href}
              className={`block px-2 py-1 text-sm rounded truncate ${
                active
                  ? "bg-muted text-fg font-medium"
                  : "text-fg-muted hover:text-fg hover:bg-muted/60"
              }`}
            >
              {n.title || t("untitled")}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
