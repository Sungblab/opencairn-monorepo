import { requireSession } from "@/lib/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  // ReactQueryProvider lives one level up at [locale]/layout.tsx — both for
  // the global Command Palette and for non-(shell) routes that share the
  // same client. Re-mounting it here would create a nested QueryClient and
  // break cache sharing across pages.
  return <div className="flex min-h-screen">{children}</div>;
}
