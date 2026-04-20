import { sql, db } from "@opencairn/db";

// DB 연결 검증 — 실패 시 전체 테스트 suite를 즉시 중단
// (dotenv는 vitest.config.ts의 configDotenv()가 모듈 평가 시점에 이미 로드함)
const result = await db.execute(sql`SELECT 1 AS ping`);
if (!result) {
  throw new Error("DB connection failed at test setup");
}
