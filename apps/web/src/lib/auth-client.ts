import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.INTERNAL_API_URL ?? "http://localhost:4000"),
}) as ReturnType<typeof createAuthClient>;
