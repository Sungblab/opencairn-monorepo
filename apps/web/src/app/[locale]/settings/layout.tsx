import { requireSession } from "@/lib/session";
import { AccountShell } from "@/components/views/account/account-shell";

// AccountShell layout — outside the (shell) route group so the sidebar / tab
// bar / agent panel don't intrude on profile / billing / security flows.
// ReactQueryProvider lives at [locale]/layout.tsx so the global Command
// Palette can run useQuery here too without a nested client.
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return <AccountShell>{children}</AccountShell>;
}
