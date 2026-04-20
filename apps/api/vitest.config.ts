import { defineConfig } from "vitest/config";
import { configDotenv } from "dotenv";
import { resolve } from "path";

// 루트 .env 파일을 vitest config 평가 시점에 로드
// — packages/db client.ts가 모듈 임포트 시 process.env.DATABASE_URL을 읽으므로
//   setupFiles 실행 이전에 주입되어야 함
configDotenv({ path: resolve(__dirname, "../../.env") });

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // 타임아웃: 실 DB 쿼리 포함이므로 여유 있게
    testTimeout: 15000,
  },
  resolve: {
    // monorepo workspace 패키지 resolve 지원
    conditions: ["development", "browser", "module", "import", "default"],
  },
});
