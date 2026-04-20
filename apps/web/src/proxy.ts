import createIntlMiddleware from "next-intl/middleware";
import { locales, defaultLocale } from "./i18n";

const intl = createIntlMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: "as-needed",
  localeDetection: true,
});

export default intl;

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
