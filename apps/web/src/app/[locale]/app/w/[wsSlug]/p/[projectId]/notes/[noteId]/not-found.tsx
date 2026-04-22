import Link from "next/link";
import { getTranslations } from "next-intl/server";

// In-app "note not found" — surfaces inside the workspace shell, so this is a
// compact editorial card, not a full-page marquee.
export default async function NoteNotFound() {
  const t = await getTranslations("common");
  return (
    <div className="p-6 sm:p-10">
      <div className="max-w-md bg-white border-2 border-stone-900 rounded-xl p-6 sm:p-8 shadow-[0_4px_0_0_#171717]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className="w-2 h-2 rounded-full bg-stone-900 pulse-dot"
                aria-hidden
              />
              <span className="font-sans text-[11px] font-semibold tracking-[0.22em] uppercase text-stone-900">
                {t("errorPages.notFound.label")}
              </span>
            </div>
            <h2 className="font-sans text-xl font-bold text-stone-900 kr">
              {t("not_found")}
            </h2>
            <p className="text-sm text-stone-600 kr">
              {t("errorPages.notFound.body")}
            </p>
          </div>
          <Link href="/" className="auth-btn auth-btn-secondary w-full kr">
            {t("errorPages.notFound.home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
