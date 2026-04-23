"use client";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";

// Shown inside the sidebar when the current route has no projectId — either
// a fresh workspace with no projects at all or a dashboard/settings route
// where "project" is out of scope. Keeps the sidebar useful by offering a
// direct create-project shortcut.
export function SidebarEmptyState() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("sidebar.project");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm text-muted-foreground">{t("empty")}</p>
      <button
        type="button"
        onClick={() =>
          router.push(`/${locale}/app/w/${wsSlug}/new-project`)
        }
        className="rounded border border-border px-3 py-1 text-xs text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        {t("create_cta")}
      </button>
    </div>
  );
}
