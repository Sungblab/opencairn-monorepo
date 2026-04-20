import { customType } from "drizzle-orm/pg-core";

// VECTOR_DIM은 .env.example 및 docker-compose.yml에서 정의 (기본 3072, Gemini gemini-embedding-2-preview).
// Ollama nomic-embed-text 등 다른 임베딩 모델 사용 시 env만 교체 (예: 768). 스키마 재작성 불필요.
const VECTOR_DIM = parseInt(process.env.VECTOR_DIM ?? "3072", 10);

export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// 이름은 기존 호환을 위해 `vector3072` 유지. 실제 차원은 VECTOR_DIM env가 결정.
// 향후 리네이밍 시 `vectorEmbedding` 같은 중립 이름으로 통일 고려.
export const vector3072 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${VECTOR_DIM})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});

// Binary storage — used by envelope-encrypted BYOK keys, future webhook secrets, etc.
// drizzle의 built-in bytea는 버전에 따라 미존재/불안정하므로 프로젝트에서 직접 선언.
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
