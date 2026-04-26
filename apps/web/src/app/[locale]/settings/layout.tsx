import { requireSession } from "@/lib/session";
import { ReactQueryProvider } from "@/lib/react-query";
import { AccountShell } from "@/components/views/account/account-shell";

// AccountShell layout — outside the (shell) route group so the sidebar / tab
// bar / agent panel don't intrude on profile / billing / security flows.
// Mounts its own ReactQueryProvider because [locale]/app/layout.tsx (which
// owns the app-side provider) doesn't apply here.
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return (
    <ReactQueryProvider>
      <AccountShell>{children}</AccountShell>
    </ReactQueryProvider>
  );
}
