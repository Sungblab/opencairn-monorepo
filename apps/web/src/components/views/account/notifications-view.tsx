"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";

import {
  notificationPreferencesApi,
  type NotificationFrequency,
  type NotificationPreferenceKind,
  type NotificationPreferenceRow,
  type NotificationProfileRow,
} from "@/lib/api-client";

const KINDS: NotificationPreferenceKind[] = [
  "mention",
  "comment_reply",
  "share_invite",
  "research_complete",
  "system",
];

const FREQUENCIES: NotificationFrequency[] = [
  "instant",
  "digest_15min",
  "digest_daily",
];

// Curated set — must match SUPPORTED_TIMEZONES in @opencairn/shared.
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

export function NotificationsView() {
  const t = useTranslations("accountNotifications");
  const qc = useQueryClient();

  const prefsQuery = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: () => notificationPreferencesApi.list(),
  });
  const profileQuery = useQuery({
    queryKey: ["notification-preferences", "profile"],
    queryFn: () => notificationPreferencesApi.profile(),
  });

  const upsert = useMutation({
    mutationFn: ({
      kind,
      body,
    }: {
      kind: NotificationPreferenceKind;
      body: Omit<NotificationPreferenceRow, "kind">;
    }) => notificationPreferencesApi.upsert(kind, body),
    onSuccess: () => {
      toast.success(t("profile.saved"));
      qc.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
    onError: () => toast.error(t("profile.saveFailed")),
  });

  const updateProfile = useMutation({
    mutationFn: (body: Partial<NotificationProfileRow>) =>
      notificationPreferencesApi.updateProfile(body),
    onSuccess: () => {
      toast.success(t("profile.saved"));
      qc.invalidateQueries({ queryKey: ["notification-preferences", "profile"] });
    },
    onError: () => toast.error(t("profile.saveFailed")),
  });

  if (!prefsQuery.data || !profileQuery.data) return null;
  const byKind = new Map(prefsQuery.data.preferences.map((p) => [p.kind, p]));

  function patch(
    kind: NotificationPreferenceKind,
    next: Partial<Omit<NotificationPreferenceRow, "kind">>,
  ) {
    const current = byKind.get(kind);
    if (!current) return;
    upsert.mutate({
      kind,
      body: {
        emailEnabled: next.emailEnabled ?? current.emailEnabled,
        frequency: next.frequency ?? current.frequency,
      },
    });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <section className="rounded-[var(--radius-card)] border border-border bg-background p-4">
        <h3 className="mb-3 text-sm font-medium">{t("preferences.heading")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4 font-medium">{t("preferences.tableHeaders.kind")}</th>
                <th className="pb-2 pr-4 font-medium">{t("preferences.tableHeaders.email")}</th>
                <th className="pb-2 font-medium">{t("preferences.tableHeaders.frequency")}</th>
              </tr>
            </thead>
            <tbody>
              {KINDS.map((kind) => {
                const row = byKind.get(kind);
                if (!row) return null;
                return (
                  <tr key={kind} className="border-t border-border align-top">
                    <td className="py-3 pr-4">
                      <div className="font-medium">{t(`preferences.kinds.${kind}.label`)}</div>
                      <div className="text-xs text-muted-foreground">
                        {t(`preferences.kinds.${kind}.description`)}
                      </div>
                    </td>
                  <td className="py-3 pr-4">
                      <label className="relative inline-flex h-7 w-7 items-center justify-center">
                        <input
                          type="checkbox"
                          className="peer absolute inset-0 h-7 w-7 cursor-pointer opacity-0"
                          aria-label={t(`preferences.kinds.${kind}.label`)}
                          checked={row.emailEnabled}
                          onChange={(e) =>
                            patch(kind, { emailEnabled: e.currentTarget.checked })
                          }
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-[var(--radius-control)] border border-border bg-background text-background transition-colors peer-checked:border-foreground peer-checked:bg-foreground"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      </label>
                  </td>
                    <td className="py-3">
                      <select
                        aria-label={t("preferences.tableHeaders.frequency")}
                        className="min-h-8 rounded-[var(--radius-control)] border border-border bg-background px-2 py-1 text-sm"
                        value={row.frequency}
                        disabled={!row.emailEnabled}
                        onChange={(e) =>
                          patch(kind, {
                            frequency: e.currentTarget.value as NotificationFrequency,
                          })
                        }
                      >
                        {FREQUENCIES.map((f) => (
                          <option key={f} value={f}>
                            {t(`preferences.frequencies.${f}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-border bg-background p-4">
        <h3 className="mb-1 text-sm font-medium">{t("profile.heading")}</h3>
        <p className="mb-3 text-xs text-muted-foreground">{t("profile.description")}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("profile.locale")}
            </span>
            <select
              className="min-h-9 w-full rounded-[var(--radius-control)] border border-border bg-background px-2 py-1.5"
              value={profileQuery.data.locale}
              onChange={(e) =>
                updateProfile.mutate({
                  locale: e.currentTarget.value as NotificationProfileRow["locale"],
                })
              }
            >
              <option value="ko">{t("profile.localeOptions.ko")}</option>
              <option value="en">{t("profile.localeOptions.en")}</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              {t("profile.timezone")}
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
      </section>
    </div>
  );
}
