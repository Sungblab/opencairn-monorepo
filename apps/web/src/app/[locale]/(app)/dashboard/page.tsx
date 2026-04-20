import { useTranslations } from "next-intl";
import { ThemeToggle } from "@/lib/theme/ThemeToggle";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  return (
    <div>
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <ThemeToggle />
      </header>
      <p className="mt-2 text-fg-muted">{t("welcome")}</p>
    </div>
  );
}
