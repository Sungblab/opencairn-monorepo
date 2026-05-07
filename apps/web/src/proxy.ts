import { type NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { defaultLocale, locales } from "./i18n-locales";

const intl = createIntlMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: "as-needed",
  localeDetection: true,
});

export default function proxy(req: NextRequest) {
  return intl(req);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
