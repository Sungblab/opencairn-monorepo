import { pgTable, text, timestamp, boolean, integer, customType } from "drizzle-orm/pg-core";
import { userPlanEnum } from "./enums";

// bytea 커스텀 타입 (drizzle의 built-in bytea는 버전에 따라 미존재/불안정)
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

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

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
