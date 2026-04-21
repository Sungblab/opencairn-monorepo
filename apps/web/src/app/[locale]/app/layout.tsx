import { ReactQueryProvider } from "@/lib/react-query";
import { requireSession } from "@/lib/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return (
    <ReactQueryProvider>
      <div className="flex min-h-screen">{children}</div>
    </ReactQueryProvider>
  );
}
