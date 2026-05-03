# Backup & Recovery Strategy

> 마지막 업데이트: 2026-05-03
> 관련 문서: `docs/architecture/storage-planning.md`, `docs/superpowers/plans/2026-04-09-plan-1-foundation.md`

OpenCairn의 데이터 백업, 복구, 사용자 데이터 포터빌리티 전략.

> **2026-05-03 구현 반영**: 셀프호스트용 `scripts/backup.sh`, `scripts/restore.sh`, `scripts/backup-verify.sh`가 추가되었다. 이 스크립트는 Docker Compose의 `postgres` 서비스 안에서 `pg_dump`/`psql`을 실행하는 Tier 2 논리 백업 도구다. Hosted production용 WAL-G/PITR 자동화는 여전히 별도 운영 범위다.

---

## 1. 보호 대상 우선순위

| 우선순위 | 데이터 | 손실 시 영향 |
|--|--|--|
| **P0** | PostgreSQL (위키, 그래프, 임베딩, Yjs, Temporal, Auth) | 회복 불가능, 수개월 작업 손실 |
| **P0** | R2 원본 파일 (PDF/DOCX/오디오 등) | 재업로드 가능하지만 전사/임베딩 비용 재발생 |
| **P1** | 사용자 설정 (테마, 단축키, 알림) | DB에 저장됨 (P0에 포함) |
| **P3** | Redis (세션, 캐시) | 휘발성, 백업 불필요 |
| **P3** | Docker 이미지 캐시 | 재빌드 가능 |

---

## 2. 백업 계층 (Tier별 전략)

### Tier 1: Production (Hosted Service) — 엄격 SLA

**RPO**: 15분 / **RTO**: 1시간

| 전략 | 도구 | 빈도 |
|--|--|--|
| **연속 WAL 아카이브** | WAL-G → R2 | 실시간 |
| **Full base backup** | WAL-G | 매일 03:00 KST |
| **Cross-region 복제** | R2 자동 복제 | 실시간 (APAC ↔ EU) |
| **R2 파일 cross-region** | R2 replication | 실시간 |
| **복구 훈련** | 수동 PITR 테스트 | 월 1회 |
| **Off-site 보관** | Backblaze B2 (cold) | 주 1회 |

**Point-in-Time Recovery 시나리오:**
```
사고: 14:23에 잘못된 DELETE 쿼리 실행
복구: WAL-G로 14:22 시점으로 PITR
       → 14:22~현재 사이 새 데이터는 별도 머지 필요
```

### Tier 2: 셀프호스트 (사용자 운영) — 단순 자동화

OpenCairn 레포에 제공하는 기본 스크립트:

```bash
docker compose up -d postgres

./scripts/backup.sh                              # 로컬 ./backups/ 폴더에 db_*.sql.gz 생성
./scripts/backup.sh --to-r2                      # R2 업로드 (aws CLI + env 필요)
./scripts/backup.sh --to-s3                      # AWS/S3 호환 업로드
./scripts/backup.sh --to-b2                      # Backblaze B2 S3 호환 업로드
./scripts/backup-verify.sh ./backups/db_*.sql.gz # 임시 DB에 복원해 핵심 테이블 확인
./scripts/restore.sh --yes ./backups/db_*.sql.gz # 대상 DB drop/create 후 복원
```

`backup.sh`는 host에 `pg_dump`를 요구하지 않고 `docker compose exec -T postgres pg_dump`를 사용한다. 기본 출력 위치는 `BACKUP_DIR=./backups`, 기본 로컬 리텐션은 `BACKUP_RETENTION_DAYS=7`이며 `db_*.sql.gz` 파일의 mtime 기준으로 정리한다. 주/월/연 GFS 리텐션은 운영자가 외부 object storage lifecycle이나 별도 cron으로 확장한다.

**주요 옵션:**

```bash
./scripts/backup.sh --help
./scripts/backup.sh --dry-run
./scripts/backup.sh --output-dir /var/backups/opencairn
./scripts/backup.sh --file ./backups/manual.sql.gz --no-retention

./scripts/restore.sh --help
./scripts/restore.sh --dry-run ./backups/manual.sql.gz
./scripts/restore.sh --yes ./backups/manual.sql.gz

./scripts/backup-verify.sh --help
./scripts/backup-verify.sh --dry-run ./backups/manual.sql.gz
./scripts/backup-verify.sh --keep-db ./backups/manual.sql.gz
```

**원격 업로드 env:**

```bash
BACKUP_DIR=./backups
BACKUP_RETENTION_DAYS=7

# Cloudflare R2
R2_BACKUP_BUCKET=
R2_BACKUP_ENDPOINT=
R2_BACKUP_ACCESS_KEY=
R2_BACKUP_SECRET_KEY=

# AWS/S3 호환
S3_BACKUP_BUCKET=
S3_BACKUP_ENDPOINT= # AWS S3이면 비워도 됨

# Backblaze B2 S3 호환
B2_BACKUP_BUCKET=
B2_BACKUP_ENDPOINT=
B2_BACKUP_ACCESS_KEY=
B2_BACKUP_SECRET_KEY=
```

**cron 등록 (권장):**
```cron
# 매일 새벽 3시 백업 + R2 업로드
0 3 * * * cd /opt/opencairn && ./scripts/backup.sh --to-r2 >> /var/log/opencairn-backup.log 2>&1
```

### Tier 3: 사용자 데이터 포터빌리티 (Obsidian 탈출구)

**OpenCairn의 차별화 포인트** — 데이터 종속 없음.

- **전체 계정 export → ZIP 다운로드**
  - 모든 위키/노트 → Markdown (Obsidian 호환 폴더 구조)
  - 지식 그래프 → JSON (`graph.json` — concepts + edges)
  - 원본 자료 → `sources/` 폴더 (PDF, 오디오 등)
  - 메타데이터 → `metadata.json`
  - 위키 변경 이력 → `wiki_logs.json`

- **선택적 export**
  - 프로젝트별 / 폴더별 / 태그별
  - 날짜 범위

- **자동 export (Pro/BYOK 플랜)**
  - 주 1회 자동 export → 사용자 본인의 R2/Dropbox/Google Drive
  - 사용자가 OAuth 연결

- **GDPR 준수** — "내 데이터 다운로드" / "내 계정 삭제"

---

## 3. 백업 도구 비교

| 도구 | 용도 | 권장 Tier |
|--|--|--|
| **WAL-G** | WAL 스트리밍 + S3/R2 업로드 + PITR | Tier 1 (Production) |
| **pg_dump + gzip** | 논리 백업, 휴대성 | Tier 2 (셀프호스트 기본) |
| pgBackRest | 엔터프라이즈 백업 | Tier 1 대안 (복잡함) |
| Barman | PostgreSQL 커뮤니티 표준 | Tier 1 대안 |
| ZFS snapshots | 파일시스템 스냅샷 | 고급 사용자 옵션 |

**선택 근거:**
- **WAL-G**: 클라우드 네이티브, R2 직접 업로드, PITR 지원, 가장 가벼움 → Production
- **pg_dump**: 외부 의존성 없음, 모든 PostgreSQL 버전 호환, 단순 → 셀프호스트

---

## 4. R2 파일 백업

R2 파일은 Cloudflare 자체가 99.999999999% durability이지만:

- **Cross-region replication** (Production): APAC ↔ EU
- **R2 versioning**: 30일 보관 (실수 삭제 복구)
- **셀프호스트**: 사용자 본인 R2 버킷 사용, replication은 사용자 책임

---

## 5. 복구 절차 (Runbook)

### 5.1 PostgreSQL 전체 복구 (Tier 2 셀프호스트)

```bash
# 1. PostgreSQL 시작 확인
docker compose up -d postgres

# 2. 백업 파일 검증 (운영 DB를 건드리지 않고 임시 DB에 복원)
./scripts/backup-verify.sh ./backups/db_20260503_030000.sql.gz

# 3. 백업 복원
./scripts/restore.sh --yes ./backups/db_20260503_030000.sql.gz

# 4. 서비스 시작 또는 재시작
docker compose start api worker hocuspocus

# 5. 무결성 확인
curl http://localhost:4000/health
```

### 5.2 PITR 복구 (Tier 1 Production)

```bash
# WAL-G로 특정 시점 복원
wal-g backup-fetch /var/lib/postgresql/data LATEST
echo "restore_command = 'wal-g wal-fetch %f %p'" >> postgresql.conf
echo "recovery_target_time = '2026-04-13 14:22:00 KST'" >> postgresql.conf
systemctl start postgresql
```

### 5.3 단일 사용자 데이터 복구

사용자 실수로 프로젝트 삭제 시:
1. Soft delete 정책 (90일 보관)으로 즉시 복구 가능
2. 90일 지났으면 → 백업에서 단일 사용자 row만 추출 (`pg_restore --table=...`)

---

## 6. 비용 추정

**Production (1000명 가입, 100명 활성, Medium 사용량 기준):**
- DB 크기: ~30 GB (1536d 임베딩 가정)
- 일일 풀 백업 압축: ~20 GB
- WAL 일일: ~5 GB
- R2 백업 저장 (30일 보관): ~750 GB → **$11.25/월** ($0.015/GB)
- Cross-region 복제: 추가 $11.25
- **총 백업 비용: ~$25/월**

→ 월 매출의 1% 미만, 무시할 수준.

**셀프호스트 (단일 사용자, Medium):**
- DB 크기: ~300 MB
- 일일 백업: ~200 MB
- 7일 보관: 1.4 GB
- 사용자 R2 비용: ~$0.02/월 (사용자 부담)

---

## 7. 백업 검증

**자동 검증 (월 1회 cron 권장):**
```bash
./scripts/backup-verify.sh ./backups/db_20260503_030000.sql.gz
# 1. 같은 compose postgres 안에 임시 DB 생성
# 2. 백업 복원
# 3. public table 수와 핵심 테이블 존재 확인
# 4. 핵심 테이블 row count 출력
# 5. 임시 DB drop (--keep-db 지정 시 보존)
```

**복구 훈련 (월 1회 수동 — Production):**
- staging 환경에 운영 백업 복원
- 핵심 시나리오 테스트 (로그인, 그래프 로드, Q&A)
- 결과 기록 → `docs/runbooks/dr-drill-YYYY-MM.md`

---

## 8. Plan 영향

### Plan 1 (Foundation)에 추가된 task:
- [x] `scripts/backup.sh` 작성 (pg_dump + gzip + 옵션 R2/S3/B2 업로드)
- [x] `scripts/restore.sh` 작성
- [x] `scripts/backup-verify.sh` 작성
- [x] `.env.example`에 백업 관련 env 추가:
  ```bash
  BACKUP_DIR=./backups
  BACKUP_RETENTION_DAYS=7
  R2_BACKUP_BUCKET=       # 옵션
  R2_BACKUP_ENDPOINT=     # 옵션
  R2_BACKUP_ACCESS_KEY=   # 옵션
  R2_BACKUP_SECRET_KEY=   # 옵션
  ```
- [x] docs를 실제 명령과 맞춤
- [ ] `docker-compose.yml`에 backups named volume 추가 — 이번 구현에서는 host-side `BACKUP_DIR`을 사용하므로 보류
- [ ] README 백업 섹션 추가 — public quick-start 정리 시 별도 반영 가능

### Plan 9 (Billing & Marketing)에 추가할 task:
- [ ] **Export API 엔드포인트** (`GET /api/export/account`)
  - 비동기 워크플로우 (Temporal)
  - ZIP 스트림 생성 (markdown + JSON + 원본 파일)
  - 완료 시 이메일 알림 (Resend)
- [ ] **Pro 플랜 자동 export** 기능
  - 주 1회 cron
  - OAuth 연결 (Dropbox/Google Drive/사용자 R2)
- [ ] 설정 페이지에 "내 데이터 다운로드" 버튼 (GDPR)
- [ ] 설정 페이지에 "계정 삭제" 버튼 (GDPR)

### Plan 8 (Remaining Agents)에 영향:
- **Curator Agent**가 soft-deleted 데이터 90일 후 hard delete 처리 (cron)

---

## 8a. Agent Runtime 리텐션 (2026-04-20 추가)

Plan 12 (Agent Runtime Standard) 관련 데이터는 독립된 리텐션 정책을 가진다. 자세한 맥락: [`docs/superpowers/specs/2026-04-20-agent-runtime-standard-design.md`](../superpowers/specs/2026-04-20-agent-runtime-standard-design.md).

| 데이터 | 위치 | 리텐션 | 삭제 주체 | 근거 |
|---|---|---|---|---|
| Temporal workflow history | Temporal 서버 | **30일** (기본값 유지) | Temporal retention policy | 과거 run 감사 / signal 추적 — agent state는 trajectory + Temporal 이벤트로 충분 (LangGraph checkpoint 미사용, 2026-04-28) |
| Trajectory NDJSON | `TRAJECTORY_DIR` (local) / S3 (hosted) | **30일** | `TRAJECTORY_RETENTION_DAYS` cron (기본 30) | Eval 재생 + 디버깅 충분. 장기보관 시 비용 과다 |
| `agent_runs` 요약 row | Postgres | **1년** | 월 단위 파티션 drop (TBD) | 비용 리포트 / 월별 사용량 추이 |
| `workspace_credits` 차감 이력 (PAYG) | Postgres | **7년** | 삭제 안 함 | 한국 세법 회계 증빙 |

### 삭제 연쇄 (Cascade)

- `workspaces.id` 삭제 → 해당 `workspace_id` prefix의 trajectory NDJSON 파일 bulk delete + `agent_runs` CASCADE
- `users.id` 삭제 (GDPR 계정 삭제) → 해당 유저의 모든 `agent_runs` CASCADE + 관련 trajectory 파일 삭제
- 삭제는 **async job**으로 처리 (Curator Agent 담당 범위 확장 예정, Plan 8)

### 셀프호스트 주의

- `TRAJECTORY_DIR`은 Docker volume으로 관리. Host 디스크 직접 마운트 비권장 (권한 이슈)
- 기본 보관 30일. 디스크 여유 적으면 `TRAJECTORY_RETENTION_DAYS=7` 등으로 축소

### Backup 대상 포함 여부

| 데이터 | Tier 1 (Production) 백업 | Tier 2 (Self-host) 백업 | 이유 |
|---|---|---|---|
| Trajectory NDJSON | ❌ | ❌ | 30일 휘발 정책. Eval 금빛 데이터셋은 별도 repo 복사 |
| `agent_runs` 요약 | ✅ | ✅ | 비용 감사 증빙 |
| `workspace_credits` | ✅ | ✅ | 회계 증빙 (법정 보관) |

---

## 9. 핵심 요약

1. **PostgreSQL은 무조건 백업** — 위키/그래프/임베딩 모두 이 안에
2. **Production은 WAL-G + R2 PITR**, 셀프호스트는 **pg_dump 기반 스크립트 제공**
3. **R2는 Cloudflare가 알아서** durability 보장하지만 cross-region replication은 켜둘 것
4. **데이터 포터빌리티가 핵심 차별화** — Markdown export 전략은 유지하되 자동 export/API는 별도 구현 필요
5. **백업 비용은 매출의 1% 미만** — 안 할 이유 없음
6. **복구 훈련 월 1회 필수** — 백업이 있어도 복구 못 하면 의미 없음
