"use client";
/* eslint-disable i18next/no-literal-string -- locale error boundary must stay self-contained and lightweight */
import { useEffect } from "react";
import { reloadPage } from "@/lib/reload-page";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
                ERROR
              </span>
            </div>
            <h1 className="font-sans text-3xl sm:text-4xl font-bold leading-tight text-stone-900 kr">
              문제가 발생했어요
            </h1>
            <p className="kr text-[15px] text-stone-600 leading-relaxed">
              페이지를 다시 불러오거나 홈으로 이동해 주세요.
              <br />
              Please reload the page or go back home.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => {
                reset();
                reloadPage();
              }}
              className="auth-btn auth-btn-primary w-full kr"
            >
              다시 시도 / Retry
            </button>
            <a href="/" className="auth-btn auth-btn-secondary w-full kr">
              홈으로 / Home
            </a>
          </div>

          {error.digest && (
            <p className="mt-2 font-mono text-[11px] tracking-wider text-stone-400 uppercase break-all">
              Error ID: {error.digest}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
