import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oneTap } from "better-auth/plugins";
import { db } from "@opencairn/db";

// trustedOrigins must include the web app URL; otherwise proxied requests
// from :3000 are rejected by Better Auth's origin validation. Reuse
// CORS_ORIGIN to keep origin trust and CORS allowlists in sync.
const trustedOrigins =
  process.env.CORS_ORIGIN?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? ["http://localhost:3000"];

const webUrl = process.env.WEB_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      console.log(`[DEV] Reset password for ${user.email}: ${url}`);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      console.log(`[DEV] Verify email for ${user.email}: ${url}`);
    },
    callbackURL: `${webUrl}/ko/auth/verify-email`,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
  },
  plugins: [oneTap()],
  trustedOrigins,
});
