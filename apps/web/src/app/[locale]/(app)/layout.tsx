export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r border-neutral-800 p-4">
        <h2 className="text-sm font-semibold text-neutral-400">OpenCairn</h2>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
