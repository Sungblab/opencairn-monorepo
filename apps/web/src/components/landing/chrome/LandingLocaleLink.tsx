"use client";

import type { ReactNode } from "react";
import type { Locale } from "@/i18n-locales";
import { writeLocaleCookie } from "@/lib/locale-cookie";

export function LandingLocaleLink({
  locale,
  ariaLabel,
  className,
  children,
}: {
  locale: Locale;
  ariaLabel: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <a
      href={`/${locale}`}
      onClick={() => writeLocaleCookie(locale)}
      aria-label={ariaLabel}
      className={className}
    >
      {children}
    </a>
  );
}
