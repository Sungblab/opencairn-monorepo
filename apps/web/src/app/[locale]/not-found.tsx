import Link from "next/link";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("common.errorPages.notFound");

  return (
    <section className="min-h-screen bg-bg flex flex-col">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-6 w-full">
        <Link href="/" className="font-serif text-2xl text-stone-900">
          OpenCairn
        </Link>
      </div>
      <div className="flex-1 flex items-center">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-10 w-full">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 mb-6">
              <span className="w-2 h-2 bg-stone-900 rounded-full" aria-hidden />
              <span className="sec-label">
                <span className="n">{t("label")}</span>
              </span>
            </div>
            <h1 className="kr font-sans text-4xl sm:text-5xl md:text-6xl leading-[1.05] text-stone-900 mb-6">
              {t("title")}
            </h1>
            <p className="kr text-lg text-stone-600 leading-relaxed mb-10 max-w-xl">{t("body")}</p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-stone-900 hover:bg-stone-800 text-stone-50 font-medium px-6 py-3 rounded-md transition-colors kr"
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
              >
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
