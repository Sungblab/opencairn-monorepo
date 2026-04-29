import { pgTable, text, timestamp, boolean, integer, uuid } from "drizzle-orm/pg-core";
import { userPlanEnum } from "./enums";
import { bytea } from "./custom-types";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  plan: userPlanEnum("plan").notNull().default("free"),

  // BYOK Gemini 키 — envelope encryption (AES-256-GCM, KEK는 앱 환경변수).
  // ciphertext 자체는 GCM의 tag를 포함한 바이너리 blob.
  byokGeminiKeyCiphertext: bytea("byok_gemini_key_ciphertext"),
  byokGeminiKeyIv: bytea("byok_gemini_key_iv"),
  // 키 회전 시 증가. 이전 version으로 암호화된 ciphertext는 재암호화 대상.
  byokGeminiKeyVersion: integer("byok_gemini_key_version"),

  // App Shell Phase 1: root `/` redirects to the user's most recent workspace
  // across devices. FK keeps the value clean if the workspace gets deleted —
  // the redirect handler falls back to "first workspace I'm a member of".
  // No FK column on workspaces here (workspaces.ownerId already references user)
  // so we need a forward-declared FK via the inline `references()` helper.
  lastViewedWorkspaceId: uuid("last_viewed_workspace_id"),

  // Plan 2 Task 14 — email-dispatcher needs the recipient's locale to pick
  // a template variant and the timezone to schedule digest_daily emails.
  // CHECK constraint on the locale column lives in the migration SQL —
  // drizzle 0.45 doesn't surface CHECKs in the schema builder.
  locale: text("locale").notNull().default("ko"),
  timezone: text("timezone").notNull().default("Asia/Seoul"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
});
