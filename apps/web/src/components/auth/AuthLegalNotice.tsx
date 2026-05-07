"use client";

import { useTranslations } from "next-intl";
import { externalSiteUrls } from "@/lib/site-config";

export function AuthLegalNotice() {
  const t = useTranslations("auth.legal");

  return (
    <p className="mx-auto max-w-[46ch] text-center text-[11px] leading-5 text-stone-500 kr">
      {t("prefix")}{" "}
      <a
        href={externalSiteUrls.terms}
        target="_blank"
        rel="noreferrer"
        className="whitespace-nowrap font-semibold text-stone-800 underline underline-offset-2 decoration-1 transition-colors hover:text-stone-950"
      >
        {t("terms")}
      </a>
      {" "}
      {t("between")}{" "}
      <a
        href={externalSiteUrls.privacy}
        target="_blank"
        rel="noreferrer"
        className="whitespace-nowrap font-semibold text-stone-800 underline underline-offset-2 decoration-1 transition-colors hover:text-stone-950"
      >
        {t("privacy")}
      </a>
      {t("suffix")}
    </p>
  );
}
