import { ThemeToggle } from "@/lib/theme/ThemeToggle";

export default function DashboardPage() {
  return (
    <div>
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <ThemeToggle />
      </header>
      <p className="mt-2 text-fg-muted">Welcome to OpenCairn.</p>
    </div>
  );
}
