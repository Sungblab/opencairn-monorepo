# Storage Planning

> 마지막 업데이트: 2026-04-14
> 관련 문서: `docs/superpowers/specs/2026-04-13-multi-llm-provider-design.md`

OpenCairn의 임베딩/벡터 DB 스토리지 요구사항과 Production 사이징 가이드.

---

## 1. 벡터 1개 크기 (차원별)

| Provider | 차원 | Raw (float32) | pgvector HNSW 인덱스 포함 |
|--|--|--|--|
| **Gemini embedding-2-preview** | 3072d | 12.0 KB | **~25 KB** |
| OpenAI text-embedding-3-small | 1536d | 6.0 KB | ~12 KB |
| nomic-embed-text (Ollama) | 768d | 3.0 KB | ~6 KB |

pgvector HNSW 인덱스는 raw 크기의 약 1.5~2배 오버헤드.

---

## 2. 청크 1개 전체 크기

```
청크 1개 총 크기 = 벡터 + 텍스트 본문 + LightRAG 엔티티·관계 + 메타
```

**Gemini 3072d 기준:**
- 벡터 (HNSW 포함): ~25 KB
- 텍스트 본문 (800 토큰 ≈ 3.2 KB)
- LightRAG 엔티티/관계 오버헤드: ~5 KB
- 메타데이터 (source_id, chunk_index, position 등): ~1 KB

→ **청크 1개 ≈ 30~35 KB**

**Ollama 768d 기준:**
- 벡터: ~6 KB
- 나머지 동일: ~9 KB

→ **청크 1개 ≈ 15 KB**

---

## 3. 사용자 1명당 저장량 시뮬레이션

가정: PDF 1개 = 평균 30페이지, 페이지당 3 청크 = 90 청크/PDF

| 사용량 레벨 | 자료량 | 총 청크 | **Gemini 3072d** | **Ollama 768d** |
|--|--|--|--|--|
| **Light** (시험 준비) | PDF 20개 | 1,800 | **~55 MB** | ~12 MB |
| **Medium** (대학원생) | PDF 100개 | 9,000 | **~275 MB** | ~60 MB |
| **Heavy** (연구자) | PDF 500개 | 45,000 | **~1.4 GB** | ~300 MB |
| **Extreme** (도서관 수준) | PDF 2,000개 | 180,000 | ~5.5 GB | ~1.2 GB |

여기에 노트/위키/대화 히스토리/Yjs 문서 등 텍스트 추가 (사용자당 ~50 MB).

---

## 4. Supabase/PaaS 무료 티어 한계 (참고)

OpenCairn은 **Docker 셀프호스팅** 사용 (Supabase/Vercel 안 씀). 아래는 "만약 PaaS 무료 티어 썼다면" 참고용.

| 서비스 | 무료 DB 용량 | Gemini Light | Medium | Heavy |
|--|--|--|--|--|
| Supabase Free | 500 MB | 9명 | 1~2명 | **0명** |
| Neon Free | 512 MB | 9명 | 1~2명 | **0명** |
| Vercel Postgres Hobby | 256 MB | 4명 | **0명** | 0명 |

→ **임베딩 DB는 PaaS 무료 티어로 운영 불가.** Self-hosted 불가피.

---

## 5. 셀프호스팅 서버 사이징 가이드

### 호스팅 옵션별 디스크

| 호스팅 | 기본 디스크 | 월 비용 | 수용 가능 사용자 수 (Medium Gemini 기준) |
|--|--|--|--|
| **Oracle Cloud Always Free (ARM A1)** | 200 GB | **$0** | ~700명 |
| Hetzner CX22 | 40 GB | €4 (~$4) | ~140명 |
| Hetzner CX32 | 80 GB | €7 (~$7) | ~280명 |
| Hetzner CX42 | 160 GB | €14 (~$14) | ~560명 |
| Fly.io + Volume | 가변 | $0.15/GB/월 | 예산 기반 |
| AWS EC2 t4g.medium + gp3 | 30 GB 기본 | ~$25 + EBS | 자유 확장 |
| DigitalOcean Droplet 2GB | 50 GB | $12 | ~175명 |

**단일 사용자 셀프호스트 기준 최소 요구사항:**
- 디스크 10 GB (OS + Docker 이미지 + 초기 DB)
- 이후 사용량에 따라 증가

### 서비스별 디스크 점유

전체 Docker 스택 기준 추정:

| 컴포넌트 | 초기 | 사용자 추가 시 증가 |
|--|--|--|
| PostgreSQL (pgvector 포함) | 1 GB | **메인 증가원** (위 표 참조) |
| Redis | 100 MB | 미미 |
| Temporal (히스토리) | 500 MB | 워크플로우당 수 KB |
| Docker 이미지 (web/api/worker 등) | ~3 GB | 고정 |
| Cloudflare R2 (파일 원본) | — | **외부 저장** (디스크 점유 없음) |
| Hocuspocus PostgreSQL extension | 포함 | Yjs 문서당 수 KB |

**R2/S3 외부 스토리지는 디스크 제약 없음** — PDF 원본은 전부 R2로 보낸다. DB에는 텍스트 추출물 + 벡터만 저장.

---

## 6. 비용 최적화 전략 (Production 운영 시)

### 6.1 벡터 차원 축소 (Matryoshka Representation Learning)

Gemini embedding-2-preview는 **MRL(Matryoshka) 지원** — 3072d 벡터를 그대로 저장하지 않고 **truncate**만 해도 의미 보존.

```python
# packages/llm/gemini.py
response = client.models.embed_content(
    model="gemini-embedding-2-preview",
    contents=texts,
    config={"output_dimensionality": 1536}  # 또는 768
)
```

**트레이드오프:**

| 차원 | 저장 용량 | 검색 품질 | 권장 상황 | Provider |
|--|--|--|--|--|
| 3072d (full) | 100% | 100% | 소수 Heavy 사용자 (기본값) | Gemini (native) |
| **1536d (Matryoshka truncate)** | **50%** | ~98% | **Production 권장 운영값** | Gemini (truncated) |
| 768d (truncate) | 25% | ~94% | 대규모 운영 / 비용 최소화 | Gemini (further truncate) / Ollama `nomic-embed-text` (native 768d) |

**권장 운영값: `VECTOR_DIM=1536`** — Matryoshka 특성상 3072d 임베딩을 앞 1536d만 slice해도 품질이 98% 유지됨 (Gemini 공식 기술 문서 근거). 스토리지 절반으로 cold-start·인덱스 빌드·pg_vector kNN 모두 가속.

**주의 (multi-llm 설계 연동):**
- `VECTOR_DIM`은 **한 배포 내에서 단일 값으로 고정**해야 한다. 차원 혼용 시 pgvector `cosine_distance` 에러.
- 배포 후 VECTOR_DIM 변경이 필요하면 전체 임베딩 재생성 필요 (마이그레이션 스크립트 필요).
- `packages/llm` spec에서 각 provider의 native 차원은 Gemini 3072 / Ollama nomic 768. truncate/padding은 DB 쪽에서 처리하지 않고 **provider adapter에서** `output_dimensionality` 파라미터로 맞춘다.

### 6.2 청크 중복 제거

같은 문서를 여러 사용자가 업로드하거나 재업로드 시 청크 해시 기반 중복 제거:

```sql
CREATE UNIQUE INDEX chunks_hash_idx ON chunks(sha256);
-- 동일 해시 = 벡터 재사용, row 하나만 저장
```

### 6.3 오래된 데이터 자동 정리

```sql
-- Curator Agent가 cron으로 실행
DELETE FROM conversations WHERE created_at < NOW() - INTERVAL '90 days';
DELETE FROM chunks WHERE source_id IN (SELECT id FROM sources WHERE archived = true);
```

### 6.4 Cold Storage 전환

- 6개월 이상 열람 안 된 PDF는 R2 Standard → R2 Infrequent Access (비용 70% 절감)
- DB의 벡터는 유지, 원본만 이동

### 6.5 Partial HNSW 인덱스

프로젝트별로 인덱스를 쪼개면 검색 속도↑ + 인덱스 크기↓:

```sql
CREATE INDEX chunks_vec_proj_a ON chunks USING hnsw (embedding vector_cosine_ops)
WHERE project_id = 'a';
```

---

## 7. Production 요금제 사이징 제안 (Plan 9 참고)

| Plan | 대상 | 청크 상한 | 예상 저장량 (1536d 가정) | 월 비용 가이드 |
|--|--|--|--|--|
| **Free** | 신규/테스트 | 500 청크 (~6 PDF) | 8 MB | $0 (광고 없음, 실험용) |
| **Pro** | 학생/연구자 | 50,000 청크 (~500 PDF) | 800 MB | $10-15/월 |
| **Team** | 소규모 팀 | 무제한 (Fair use) | ~5 GB | $30-50/월 |
| **BYOK Gemini** | 파워 유저 | 무제한 | 무제한 | $5/월 (스토리지/서버 cost만) |
| **Self-hosted** | 프라이버시/오픈소스 | 무제한 | 서버 디스크에 따라 | $0 (Docker) |

---

## 8. Plan별 용량 매핑

[billing-model.md](./billing-model.md) 가격 표의 스토리지 한도를 실제 자료량으로 환산:

| Plan | 스토리지 한도 | 가정 PDF 개수 (9KB 청크, 3072d) | 가정 사용자 프로필 |
|------|-------------|--------------------------------|------------------|
| Free | 100 MB | ~40 | 가벼운 개인 노트 |
| Pro | 10 GB | ~3,600 | Medium(100 PDF/월) × 36개월 OR Heavy(500 PDF/월) × 7개월 |
| BYOK | 무제한 | 본인 인프라 | — |

- 계산: PDF 1개 ≈ 90 청크, 청크 1개 ≈ 30~35 KB (§2). 따라서 10GB ≈ 약 3,600 PDF.
- 상세 가격·크레딧·구독료: [billing-model.md](./billing-model.md) §가격 표.

---

## 9. 핵심 요약

1. **Supabase 무료 티어 500MB는 턱도 없음** — 1~2명 Medium 유저에 소진
2. **OpenCairn은 셀프호스팅이라 이 문제 없음** — Oracle Free Tier 200GB로도 수백 명 수용 가능
3. **벡터 차원이 스토리지의 주범** — `VECTOR_DIM=1536`으로 Gemini Matryoshka truncate 권장
4. **원본 파일은 R2에** — DB는 텍스트 추출물 + 벡터만
5. **Production 요금제는 청크 수로 상한** — GB 기준보다 명확하고 예측 가능
