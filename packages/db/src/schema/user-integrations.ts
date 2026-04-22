import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { user } from "./users";
import { bytea } from "./custom-types";
import { integrationProviderEnum } from "./enums";

// Per-user third-party OAuth credentials. One row per (user, provider).
// Tokens are AES-256-GCM encrypted with INTEGRATION_TOKEN_ENCRYPTION_KEY —
// never stored in plaintext. See apps/api/src/lib/integration-tokens.ts.
export const userIntegrations = pgTable(
  "user_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    accessTokenEncrypted: bytea("access_token_encrypted").notNull(),
    refreshTokenEncrypted: bytea("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    accountEmail: text("account_email"),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("user_integrations_user_provider_unique").on(t.userId, t.provider),
  ]
);

export type UserIntegration = typeof userIntegrations.$inferSelect;
export type UserIntegrationInsert = typeof userIntegrations.$inferInsert;
