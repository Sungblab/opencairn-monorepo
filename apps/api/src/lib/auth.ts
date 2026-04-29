import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oneTap } from "better-auth/plugins";
import { db } from "@opencairn/db";
import { sendResetPasswordEmail, sendVerificationEmail } from "./email";
import { trustedOriginsFromEnv } from "./security";

// trustedOrigins must include the web app URL; otherwise proxied requests
// from :3000 are rejected by Better Auth's origin validation. Reuse
// CORS_ORIGIN to keep origin trust and CORS allowlists in sync.
const trustedOrigins = trustedOriginsFromEnv();

const webUrl = process.env.WEB_URL ?? "http://localhost:3000";

// Google OAuth is only registered when both credentials are present. Empty-
// string fallbacks let the server accept `/sign-in/social?provider=google`
// and hit Google with blank clientId — an opaque failure path that leaked
// stack traces in the old setup. When unset we omit the provider and the
// One Tap plugin entirely, so Better Auth cleanly rejects the route.
// [Tier 1 item 1-7 / Plan 1 C-3]
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const googleOAuthEnabled = Boolean(googleClientId && googleClientSecret);

if (!googleOAuthEnabled && process.env.NODE_ENV !== "test") {
  console.info(
    "[auth] Google OAuth disabled — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable.",
  );
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    // Real delivery via lib/email.ts — Resend / SMTP / console depending on
    // EMAIL_PROVIDER. Errors surface through Better Auth as a 500 so the
    // user sees "메일 전송에 실패했습니다" instead of a silent half-signup.
    sendResetPassword: async ({ user, url }) => {
      await sendResetPasswordEmail(user.email, { resetUrl: url });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail(user.email, { verifyUrl: url });
    },
    callbackURL: `${webUrl}/ko/auth/verify-email`,
  },
  socialProviders: googleOAuthEnabled
    ? {
        google: {
          clientId: googleClientId!,
          clientSecret: googleClientSecret!,
        },
      }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 7,
  },
  // Tier 0 item 0-4 (Plan 1 C-5): enable Better Auth's per-IP rate limiter so
  // /sign-in, /sign-up, /forget-password etc. are not open brute-force or
  // enumeration targets. Development has rate limiting disabled by default —
  // `enabled: true` turns it on everywhere. Tighter custom rules cover the
  // highest-abuse paths (account creation and password reset). Memory storage
  // is per-process; multi-instance deployments should move this to the DB
  // adapter (tracked as a Tier 1 follow-up).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-up/email": { window: 60, max: 5 },
      "/sign-in/email": { window: 60, max: 10 },
      "/forget-password": { window: 60, max: 3 },
      "/send-verification-email": { window: 60, max: 3 },
    },
  },
  plugins: googleOAuthEnabled ? [oneTap()] : [],
  trustedOrigins,
});
