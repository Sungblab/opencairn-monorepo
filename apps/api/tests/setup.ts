import { config } from "dotenv";
import { resolve } from "path";
import { sql } from "@opencairn/db";
import { db } from "@opencairn/db";

// 루트 .env 로드 (apps/api → ../../.env)
config({ path: resolve(import.meta.dirname, "../../.env") });

// DB 연결 검증 — 실패 시 전체 테스트 suite를 즉시 중단
const result = await db.execute(sql`SELECT 1 AS ping`);
if (!result) {
  throw new Error("DB connection failed at test setup");
}
