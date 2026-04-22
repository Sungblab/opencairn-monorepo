# ADR-007: Embedding Model Switch — gemini-embedding-2-preview → gemini-embedding-001 (768d MRL)

## Status: Accepted (2026-04-21)

## Context

초기 Plan 1/3 설계 당시 `gemini-embedding-2-preview` (멀티모달, native 3072d)를 기본 임베딩 모델로 선정. Plan 3 인제스트 파이프라인 가동 이후 다음 현실 제약이 드러남:

- Preview 모델 TPM 상한이 1M으로 낮고 **Batch API 미지원** → 대량 인제스트 시 rate-limit 직격.
- 텍스트 전용 인제스트가 압도적 다수(95%+)인데 **멀티모달 모델의 가격 프리미엄 지불 중**: $0.20/1M text vs GA 텍스트 모델 $0.15/1M.
- `text-embedding-004`는 2026-01-14 deprecated. `gemini-embedding-001`이 GA 후속으로 MTEB multilingual #1 (68.32) 차지.
- 3072d native 저장은 pgvector 기준 1벡터당 12KB → 대규모 코퍼스에서 스토리지/HNSW 인덱스 빌드/kNN 레이턴시 모두 병목.

## Decision

1. **기본 임베딩 모델: `gemini-embedding-001`** (텍스트 전용, GA, MTEB multilingual 1위).
2. **Matryoshka truncation으로 768d 저장** — `VECTOR_DIM=768` default, provider adapter에서 `output_dimensionality=768`을 반드시 forward.
3. **Gemini Developer API 사용** (Vertex AI 아님) — BYOK/관리형 양쪽 동일. Vertex 전환은 엔터프라이즈 요건 생기면 재검토.
4. **Batch API 전환은 별도 Plan으로 분리** — `asyncBatchEmbedContent` 기반 인제스트는 Temporal activity 구조 변경을 수반하므로 Plan 3 확장으로 다룬다. 본 ADR은 단건 embed 경로의 모델·차원만 변경. **후속: Plan 3b + ADR-008**에서 `BatchEmbedWorkflow` + `embedding_batches` 테이블로 구현 완료 (2026-04-22).
5. **멀티모달 임베딩이 필요한 경로(이미지/음성 전용 features)**에 한해 `EMBED_MODEL=gemini-embedding-2-preview`로 env 덮어쓰기 허용. 혼용 시 provider/차원을 호출부가 아니라 config로 분리.

## Tradeoffs

| 기준 | embedding-2-preview 3072d (이전) | embedding-001 768d (현재) |
|------|----------------------------------|---------------------------|
| MTEB multilingual | 001과 대등 (텍스트) | **68.32 (#1)** |
| 단가 (standard) | $0.20 / 1M | $0.15 / 1M |
| **Batch API** | ❌ | ✅ **$0.075 / 1M** |
| Native 차원 | 3072 | 3072 (MRL로 768 사용) |
| 품질 손실 (3072→768) | — | **~0.26% MTEB drop** (실험 벤치마크) |
| 저장 per vector | ~12 KB | **~3 KB (4x 감소)** |
| 멀티모달 | 텍스트·이미지·음성·영상 | 텍스트 전용 |
| Rate limit 여유 | TPM 1M 빠듯 | GA 모델 + Batch 별도 큐 |

## Migration

- Drizzle migration `0007_natural_proemial_gods.sql`: `concepts.embedding` / `notes.embedding` `vector(3072) → vector(768)`. 기존 벡터는 **NULL 세팅 후 ALTER** (pgvector 자동 캐스트 불가, 재임베딩 전제).
- Plan 4 Phase B E2E smoke를 이미 통과한 dev DB는 재임베딩 필요. `pnpm db:migrate` 이후 인제스트 워크플로우 재실행.
- `packages/llm`은 `VECTOR_DIM` env를 읽어 `EmbedContentConfig.output_dimensionality`로 전달 (`gemini.py:embed`). 테스트 커버됨.

## Consequences

- **절감**: 실효가 기준 `embed-2-preview $0.20 → embedding-001 standard $0.15` (25% 감소). Batch API 도입 시 $0.075 (추가 50% 감소 = 전체 62%).
- **품질**: MTEB 0.26% 손실은 RAG/하이브리드 검색 체감 불가 수준. 한국어 retrieval은 오히려 001이 #1이라 상승 여지.
- **스키마 유연성**: `VECTOR_DIM` env 기반 customType 유지 — BYOK 사용자가 Ollama 768d나 커스텀 차원으로 쉽게 전환.
- **제약**: 텍스트 전용. 이미지/음성 임베딩은 별도 모델로 이원화하거나 embed-2-preview 병행 필요.
- **후속**: Batch API 통합 Plan 필요 (Temporal async job + JSONL 결과 수신 + 재호출 idempotency).

## References

- MTEB multilingual leaderboard: gemini-embedding-001 #1 (68.32, 2025 GA 시점).
- MRL 실측: 3072→768 retrieval recall@10 drop ~0.3%; 3072→256은 약 1-2% drop.
- Gemini 공식 문서 (로컬): `references/Gemini_API_docs/06-embeddings/Embeddings.md`, `08-batch/Batch API.md`, `00-meta/Gemini Developer API pricing.md:802-852`.
- 2026-04-21 세션 의사결정 기록.
