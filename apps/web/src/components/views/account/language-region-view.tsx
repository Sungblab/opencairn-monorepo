"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { locales, localeNames, type Locale } from "@/i18n-locales";
import { writeLocaleCookie } from "@/lib/locale-cookie";
import {
  notificationPreferencesApi,
  type NotificationProfileRow,
} from "@/lib/api-client";

const TIMEZONES = [
  "Asia/Seoul",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Australia/Sydney",
];

function localeHref(pathname: string, current: string, next: Locale) {
  const stripped = pathname.replace(new RegExp(`^/${current}(?=/|$)`), "");
  return `/${next}${stripped || ""}`;
}

export function LanguageRegionView() {
  const t = useTranslations("account.languageRegion");
  const tNotifications = useTranslations("accountNotifications.profile");
  const locale = useLocale() as Locale;
  const pathname = usePathname() ?? `/${locale}`;
  const qc = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["notification-preferences", "profile"],
    queryFn: () => notificationPreferencesApi.profile(),
  });
  const updateProfile = useMutation({
    mutationFn: (body: Partial<NotificationProfileRow>) =>
      notificationPreferencesApi.updateProfile(body),
    onSuccess: () => {
      toast.success(tNotifications("saved"));
      qc.invalidateQueries({
        queryKey: ["notification-preferences", "profile"],
      });
    },
    onError: () => toast.error(tNotifications("saveFailed")),
  });

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t("heading")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <section className="rounded-[var(--radius-card)] border border-border bg-background p-4">
        <h2 className="text-sm font-semibold">{t("appLanguage")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {locales.map((loc) => {
            const active = loc === locale;
            return (
              <Link
                key={loc}
                href={localeHref(pathname, locale, loc)}
                onClick={() => writeLocaleCookie(loc)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-control)] border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-foreground bg-muted font-semibold text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {localeNames[loc]}
                {active && <Check aria-hidden className="h-3.5 w-3.5" />}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-border bg-background p-4">
        <h2 className="text-sm font-semibold">{t("emailRegion")}</h2>
        {!profileQuery.data ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {tNotifications("loading")}
          </p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {tNotifications("locale")}
              </span>
              <select
                className="min-h-9 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5"
                value={profileQuery.data.locale}
                onChange={(e) =>
                  updateProfile.mutate({
                    locale:
                      e.currentTarget.value as NotificationProfileRow["locale"],
                  })
                }
              >
                <option value="ko">{tNotifications("localeOptions.ko")}</option>
                <option value="en">{tNotifications("localeOptions.en")}</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {tNotifications("timezone")}
              </span>
              <select
                className="min-h-9 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5"
                value={profileQuery.data.timezone}
                onChange={(e) =>
                  updateProfile.mutate({ timezone: e.currentTarget.value })
                }
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </section>
    </section>
  );
}
