import { z } from "zod";

const schema = z.object({
  HOCUSPOCUS_PORT: z.coerce.number().int().positive().default(1234),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:4000"),
  HOCUSPOCUS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((value, ctx) => {
      const origins = parseOrigins(value, ctx);
      if (origins.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "HOCUSPOCUS_ORIGINS must contain at least one origin",
        });
        return z.NEVER;
      }
      return origins;
    }),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return schema.parse(source);
}

function parseOrigins(
  value: string,
  ctx: z.RefinementCtx,
): string[] {
  const rawOrigins = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const origins: string[] = [];
  for (const rawOrigin of rawOrigins) {
    try {
      origins.push(new URL(rawOrigin).origin);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid HOCUSPOCUS_ORIGINS entry: ${rawOrigin}`,
      });
    }
  }
  return origins;
}

export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  return origin != null && allowedOrigins.includes(origin);
}
