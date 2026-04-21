import { createAuthClient } from "better-auth/react";
import { oneTapClient } from "better-auth/client/plugins";

// Cast to base ReturnType to avoid TS2742 (un-portable inferred type).
// The oneTapClient plugin still runs at runtime and adds .oneTap() to the instance.
export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.INTERNAL_API_URL ?? "http://localhost:4000"),
  plugins: [
    oneTapClient({
      clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
    }),
  ],
}) as ReturnType<typeof createAuthClient>;
