import { defineConfig } from "vitest/config";
import { configDotenv } from "dotenv";
import { resolve } from "path";

// 루트 .env를 vitest config 평가 시점에 로드
// — createDb(process.env.DATABASE_URL!)가 테스트 모듈 임포트 시 평가되므로
//   그 전에 주입되어야 함. api/vitest.config.ts와 동일한 패턴.
configDotenv({ path: resolve(__dirname, "../../.env") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
  },
  resolve: {
    // monorepo workspace 패키지 resolve 지원
    conditions: ["development", "browser", "module", "import", "default"],
  },
});
