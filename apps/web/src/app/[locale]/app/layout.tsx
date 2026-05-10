import { requireSession } from "@/lib/session";
import { LocaleAppProviders } from "@/components/providers/locale-app-providers";
import { IntlClientProvider } from "@/components/providers/intl-client-provider";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return (
    <IntlClientProvider>
      <LocaleAppProviders>
        <div className="flex min-h-screen">{children}</div>
      </LocaleAppProviders>
    </IntlClientProvider>
  );
}
