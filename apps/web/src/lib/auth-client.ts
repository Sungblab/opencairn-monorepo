import { createAuthClient } from "better-auth/react";
import { oneTapClient } from "better-auth/client/plugins";

// NEXT_PUBLIC_GOOGLE_CLIENT_ID is inlined at build time. When the workspace
// operator has not configured Google OAuth we skip the oneTapClient plugin
// entirely and keep the Google button / One Tap UI hidden downstream, so
// end-users never see a social-login affordance that would fail opaquely.
// Mirrors the server-side `googleOAuthEnabled` gate in apps/api/src/lib/auth.ts.
// [Tier 1 item 1-7 / Plan 1 C-3]
export const googleOAuthEnabled = Boolean(
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim(),
);

// Cast to base ReturnType to avoid TS2742 (un-portable inferred type).
// The oneTapClient plugin still runs at runtime and adds .oneTap() to the instance.
export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.INTERNAL_API_URL ?? "http://localhost:4000"),
  plugins: googleOAuthEnabled
    ? [
        oneTapClient({
          clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
        }),
      ]
    : [],
}) as ReturnType<typeof createAuthClient>;
