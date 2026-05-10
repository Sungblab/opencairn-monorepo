/* eslint-disable i18next/no-literal-string -- locale not-found boundary must stay self-contained and lightweight */

export default function NotFound() {
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
                NOT FOUND
              </span>
            </div>
            <h1 className="font-sans text-3xl sm:text-4xl font-bold leading-tight text-stone-900 kr">
              페이지를 찾을 수 없어요
            </h1>
            <p className="kr text-[15px] text-stone-600 leading-relaxed">
              주소가 바뀌었거나 삭제된 페이지일 수 있어요.
              <br />
              The page may have moved or no longer exists.
            </p>
          </div>

          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 w-full h-11 bg-stone-900 hover:bg-stone-50 hover:text-stone-900 text-stone-50 font-semibold text-sm px-4 rounded-md border-2 border-stone-900 shadow-[0_3px_0_0_#171717] hover:shadow-[0_4px_0_0_#171717] active:translate-y-[3px] active:shadow-[0_0_0_0_#171717] transition-all kr"
          >
            홈으로 / Home
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
          </a>
        </div>
      </div>
    </section>
  );
}
