import Link from "next/link";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("common.errorPages.notFound");

  return (
    <section className="min-h-screen bg-stone-100 flex flex-col lg:flex-row">
      {/* LEFT — editorial "404" display */}
      <div className="lg:flex-1 bg-stone-900 text-stone-50 flex flex-col p-10 lg:p-16 relative overflow-hidden">
        <Link
          href="/"
          className="self-start font-serif text-2xl text-stone-50 hover:bg-stone-50 hover:text-stone-900 px-3 py-1 rounded-md transition-colors relative z-10"
        >
          OpenCairn
        </Link>

        <div className="flex-1 flex flex-col justify-center gap-8 relative z-10 mt-10 lg:mt-0">
          <div className="flex items-center gap-2.5">
            <span
              className="w-2 h-2 rounded-full bg-stone-400 pulse-dot"
              aria-hidden
            />
            <span className="font-sans text-[11px] font-semibold tracking-[0.22em] uppercase text-stone-400">
              {t("label")}
            </span>
          </div>

          <p
            className="font-sans text-[140px] sm:text-[180px] xl:text-[220px] leading-[0.85] font-black tracking-tighter text-stone-50 select-none"
            aria-hidden
          >
            404
          </p>

          {/* tilted / broken cairn — fits the "unstacked stones" metaphor */}
          <div className="flex flex-col-reverse items-start gap-[4px] max-w-[220px]">
            {[
              { w: 176, h: 20, rot: 0 },
              { w: 140, h: 18, rot: -2 },
              { w: 108, h: 16, rot: 3 },
              { w: 80, h: 14, rot: -4 },
              { w: 58, h: 12, rot: 6 },
            ].map((s, i) => (
              <span
                key={i}
                className="block rounded-full bg-stone-700 border border-stone-600"
                style={{
                  width: s.w,
                  height: s.h,
                  transform: `rotate(${s.rot}deg) translateX(${s.rot * 2}px)`,
                }}
              />
            ))}
            {/* fallen stone */}
            <span
              className="block rounded-full bg-stone-600 border border-stone-500"
              style={{
                width: 36,
                height: 10,
                transform: "translate(160px, -120px) rotate(62deg)",
              }}
              aria-hidden
            />
          </div>
        </div>

        {/* subtle grid overlay echoing the landing + auth rhythm */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px)",
            backgroundSize: "calc(100% / 12) 100%",
          }}
          aria-hidden
        />
      </div>

      {/* RIGHT — message + CTA */}
      <div className="lg:flex-1 flex items-center justify-center px-6 py-12 lg:py-16">
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
      </div>
    </section>
  );
}
