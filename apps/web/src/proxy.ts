import { NextResponse, type NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { locales, defaultLocale } from "./i18n";

const intl = createIntlMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: "as-needed",
  localeDetection: true,
});

// Landing routes: root and any locale-prefixed root. Keep this tight — users
// should still be able to reach /privacy, /terms, /auth/* even when signed in.
const LANDING_PATHS = new Set<string>(["/", ...locales.flatMap((l) => [`/${l}`, `/${l}/`])]);

// Better Auth sets the session cookie with the `__Secure-` prefix over HTTPS
// and the bare name over HTTP. Presence (not validity) is enough — stale
// cookies round-trip through /dashboard's server-side session check and bounce to
// /auth/login. False positives are harmless.
const SESSION_COOKIE_NAMES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

function pickLocale(pathname: string): string {
  for (const l of locales) {
    if (pathname === `/${l}` || pathname.startsWith(`/${l}/`)) return l;
  }
  return defaultLocale;
}

export default function proxy(req: NextRequest) {
  if (LANDING_PATHS.has(req.nextUrl.pathname)) {
    const hasSession = SESSION_COOKIE_NAMES.some((n) => req.cookies.has(n));
    if (hasSession) {
      const target = req.nextUrl.clone();
      target.pathname = `/${pickLocale(req.nextUrl.pathname)}/dashboard`;
      return NextResponse.redirect(target);
    }
  }
  return intl(req);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
