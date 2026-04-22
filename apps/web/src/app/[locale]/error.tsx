"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common.errorPages.server");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="min-h-screen bg-stone-100 flex flex-col lg:flex-row">
      {/* LEFT — editorial "500" display */}
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
            500
          </p>

          {/* collapsed cairn — stones strewn downward (500 = system fell over) */}
          <div className="flex flex-col-reverse items-start gap-[4px] max-w-[260px] relative h-[120px]">
            {[
              { w: 176, h: 20, rot: 0, y: 0 },
              { w: 140, h: 18, rot: -6, y: 0 },
              { w: 108, h: 16, rot: 9, y: 0 },
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
            {/* fallen stones */}
            {[
              { w: 80, h: 14, x: 200, y: -20, rot: 72 },
              { w: 48, h: 12, x: 260, y: 0, rot: 28 },
              { w: 30, h: 10, x: 240, y: 30, rot: -50 },
            ].map((s, i) => (
              <span
                key={`fallen-${i}`}
                className="block rounded-full bg-stone-600 border border-stone-500 absolute"
                style={{
                  width: s.w,
                  height: s.h,
                  left: s.x,
                  bottom: s.y,
                  transform: `rotate(${s.rot}deg)`,
                }}
                aria-hidden
              />
            ))}
          </div>
        </div>

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

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={reset}
                className="auth-btn auth-btn-primary w-full kr"
              >
                {t("retry")}
              </button>
              <Link href="/" className="auth-btn auth-btn-secondary w-full kr">
                {t("home")}
              </Link>
            </div>

            {error.digest && (
              <p className="mt-2 font-mono text-[11px] tracking-wider text-stone-400 uppercase break-all">
                {t("digest")}: {error.digest}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
