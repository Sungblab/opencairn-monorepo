import Link from "next/link";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("common.errorPages.notFound");

  return (
    <section className="min-h-screen bg-stone-100 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md bg-white border-2 border-stone-900 rounded-xl p-8 sm:p-10 shadow-[0_4px_0_0_#171717]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className="w-2 h-2 rounded-full bg-stone-900 pulse-dot"
                aria-hidden
              />
              <span className="font-sans text-[11px] font-semibold tracking-[0.22em] uppercase text-stone-900">
                {t("label")}
              </span>
            </div>
            <h1 className="font-sans text-3xl sm:text-4xl font-bold leading-tight text-stone-900 kr">
              {t("title")}
            </h1>
            <p className="kr text-[15px] text-stone-600 leading-relaxed">
              {t("body")}
            </p>
          </div>

          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 w-full h-11 bg-stone-900 hover:bg-stone-50 hover:text-stone-900 text-stone-50 font-semibold text-sm px-4 rounded-md border-2 border-stone-900 shadow-[0_3px_0_0_#171717] hover:shadow-[0_4px_0_0_#171717] active:translate-y-[3px] active:shadow-[0_0_0_0_#171717] transition-all kr"
          >
            {t("home")}
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
