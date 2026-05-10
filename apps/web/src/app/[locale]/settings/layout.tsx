import { requireSession } from "@/lib/session";
import { AccountShell } from "@/components/views/account/account-shell";
import {
  ACCOUNT_TABS,
  type AccountShellLabels,
} from "@/components/views/account/account-shell-config";
import type { Locale } from "@/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { IntlClientProvider } from "@/components/providers/intl-client-provider";

// AccountShell layout — outside the (shell) route group so the sidebar / tab
// bar / agent panel don't intrude on profile / billing / security flows.
export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  await requireSession();
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "account",
  });
  const labels: AccountShellLabels = {
    title: t("title"),
    back: t("back"),
    tabs: Object.fromEntries(
      ACCOUNT_TABS.map((tab) => [tab, t(`tabs.${tab}`)]),
    ) as AccountShellLabels["tabs"],
  };

  return (
    <IntlClientProvider
      namespaces={["account", "accountNotifications", "settings"]}
    >
      <AccountShell locale={locale} labels={labels}>
        {children}
      </AccountShell>
    </IntlClientProvider>
  );
}
