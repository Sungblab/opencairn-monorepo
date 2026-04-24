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
    </section>
  );
}
