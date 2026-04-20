import type { ResolvedRole } from "./permissions";

// Hono context variable types shared across route files.
// Populated by authMiddleware (auth.ts) and requireWorkspaceRole (require-role.ts).
export type AppEnv = {
  Variables: {
    user: { id: string; email: string; name: string };
    session: unknown;
    userId: string;
    wsRole: ResolvedRole;
  };
};
