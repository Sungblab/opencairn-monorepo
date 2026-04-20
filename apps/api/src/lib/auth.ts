import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@opencairn/db";

// trustedOrigins must include the web app URL; otherwise proxied requests
// from :3000 are rejected by Better Auth's origin validation. Reuse
// CORS_ORIGIN to keep origin trust and CORS allowlists in sync.
const trustedOrigins =
  process.env.CORS_ORIGIN?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? ["http://localhost:3000"];

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
  },
  trustedOrigins,
});
