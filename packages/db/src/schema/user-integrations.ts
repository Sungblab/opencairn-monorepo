import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { user } from "./users";
import { workspaces } from "./workspaces";
import { bytea } from "./custom-types";
import { integrationProviderEnum } from "./enums";

// Per-(user, workspace) third-party OAuth credentials. One row per
// (user, workspace, provider). Tokens are AES-256-GCM encrypted with
// INTEGRATION_TOKEN_ENCRYPTION_KEY — never stored in plaintext. See
// apps/api/src/lib/integration-tokens.ts.
//
// `workspaceId` is nullable for migration safety (Ralph audit S3-022): rows
// created before the per-workspace split cannot be reattributed to a
// specific workspace, so they remain as orphans and the API filters them
// out by always querying with `eq(workspaceId, ...)`. New OAuth callbacks
// always write `workspaceId` from the signed state. Postgres treats NULL
// as distinct in unique constraints, so legacy NULL rows do not collide
// on the new (user, workspace, provider) uniqueness.
export const userIntegrations = pgTable(
  "user_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
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
    unique("user_integrations_user_workspace_provider_unique").on(
      t.userId,
      t.workspaceId,
      t.provider,
    ),
  ]
);

export type UserIntegration = typeof userIntegrations.$inferSelect;
export type UserIntegrationInsert = typeof userIntegrations.$inferInsert;
