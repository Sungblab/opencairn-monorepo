import Link from "next/link";
import { useTranslations } from "next-intl";

export function LandingFooter() {
  const t = useTranslations("common.footer");
  return (
    <footer className="border-t border-[color:var(--brand-stone-200)] bg-[color:var(--brand-paper)] py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-[color:var(--brand-stone-500)] md:flex-row md:justify-between">
        <p>{t("copyright")}</p>
        <nav className="flex gap-6">
          <Link href="/privacy" className="hover:text-[color:var(--brand-stone-900)]">{t("legal.privacy")}</Link>
          <Link href="/terms" className="hover:text-[color:var(--brand-stone-900)]">{t("legal.terms")}</Link>
          <Link href="/refund" className="hover:text-[color:var(--brand-stone-900)]">{t("legal.refund")}</Link>
          <a
            href="https://github.com/Sungblab/opencairn-monorepo"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[color:var(--brand-stone-900)]"
          >
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
