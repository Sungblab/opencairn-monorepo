# OpenCairn 종합 시장·경쟁력 딥 리서치 (2026-04-30)

> 1인 founder의 OpenCairn(AI-powered 개인+팀 지식 OS, AGPLv3, Docker self-host, BYOK Gemini/Ollama,
> 12 AI agents, multi-LLM, Plate v49 editor + Hocuspocus 협업 + Cytoscape KG + Synthesis Export +
> SM-2 학습)이 글로벌·한국 시장에서 어디에 서 있고, 어떻게 진입하면 가장 합리적인지에 대한 사실 베이스.
>
> Subagent 3개(직접 경쟁자 심층 / 한국 시장·규제 / OSS 상용화 패턴) 병렬 조사 결과 종합. 본 문서는
> plan/spec 아닌 **의사결정 자료**. 후속 brainstorming/spec 단계의 사실 인용처로 사용.
>
> 페어링 문서: `ai-native-positioning-notes.md`(영감), `ai-native-research-2026-04-30.md`(1차 사실).

---

## §1 카테고리 지도 — OpenCairn은 어디에 서 있는가

직전 라운드의 가설("Khoj가 가장 직접 경쟁자")은 **부분적으로 틀렸음**. 실제 카테고리는 두 축으로 갈라짐.

```
            [편집기 / 협업 / 노트 OS]                     [AI / RAG / Agent]
                    ↓                                              ↓
     ┌────────────────────────────┐         ┌────────────────────────────┐
     │ Notion AI (closed)         │         │ Khoj (AGPLv3)              │
     │ AFFiNE (OSS)               │         │ Onyx (MIT/EE)              │
     │ AppFlowy (OSS)             │         │ AnythingLLM (MIT)          │
     │ Outline (BSL)              │         │ Open WebUI                 │
     │ Logseq (OSS)               │         │ LangChain/LlamaIndex       │
     └────────────────────────────┘         └────────────────────────────┘
                    ↘                                              ↙
                              ┌──────────────────────────┐
                              │   OpenCairn (AGPLv3)      │
                              │   두 축 동시 점유 시도       │
                              └──────────────────────────┘
```

- 노트 OS 축의 OSS는 **AI/agent 깊이가 얕다** — AFFiNE/AppFlowy/Logseq 모두 자체 RAG 또는 Ollama 채팅 수준이지 specialized agent pipeline·Deep Research·Synthesis Export·SM-2가 없음.
- AI/agent 축의 OSS는 **편집기·협업·KG 시각화가 없다** — Khoj는 채팅+검색, Onyx는 enterprise Q&A, AnythingLLM은 워크스페이스 RAG + Agent Flows 수준이지 Notion-like 블록 에디터 + Yjs 협업 + Cytoscape KG가 통합되어 있지 않음.
- **두 축을 가로지르는 통합 OSS 제품은 본 리서치 범위에서 발견되지 않음**.

## §2 결정적 기능 매트릭스 — 정직 평가

| 기능 | OpenCairn | Khoj | Onyx | AnythingLLM | Notion AI 3.3 | AFFiNE |
|---|---|---|---|---|---|---|
| 블록 에디터(Plate/Notion-like) | ✅ Plate v49 | ❌ | ❌ | ⚠️ basic | ✅ | ✅ |
| 실시간 협업(Yjs/CRDT) | ✅ Hocuspocus | ❌ | ❌ | ❌ | ✅ | ⚠️ 부분 |
| KG 시각화(인터랙티브) | ✅ Cytoscape 5뷰 | ❌ | ⚠️ 검색 정확도용 내부 그래프, 시각화 X | ❌ | ❌ | ❌ |
| 12 specialized agent + cron orchestration | ✅ Synthesis/Curator/Connector/Staleness/Narrator | ⚠️ custom agent 1종 | ⚠️ Agentic RAG | ⚠️ Agent Flows(visual) | ⚠️ Custom Agents (closed) | ❌ |
| Deep Research | ✅ Phase A~E | ✅ `/research` | ✅ | ❌ | ⚠️ Q&A 수준 | ❌ |
| Synthesis Export(LaTeX/Tectonic/DOCX) | ✅ Phases A–F | ❌ | ❌ | ❌ | ⚠️ PDF/MD | ⚠️ PDF |
| 학습 시스템 SM-2 flashcard | ✅ Plan 6 | ❌ | ❌ | ❌ | ❌ | ❌ |
| Self-host(Docker) | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| 라이선스 | ✅ AGPLv3 | ✅ AGPLv3 | ⚠️ MIT(FOSS) + EE proprietary | ⚠️ MIT + commercial | ❌ closed | ⚠️ MIT 변형 |
| Multi-LLM BYOK | ✅ Gemini/Ollama | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| Workspace 격리(3계층) | ✅ Workspace→Project→Page | ⚠️ 단일유저 중심 | ✅ enterprise tier | ⚠️ flat workspace | ✅ | ⚠️ |
| 한국어 1급(UI i18n + tone) | ✅ | ⚠️ 임베딩만 | ⚠️ | ⚠️ | ⚠️ 번역 UI | ⚠️ |
| MCP server 노출 | ❌ **갭** | ❌ | ✅ | ✅ | ✅ | ❌ |
| MCP client | ✅ Phase 1 | ⚠️ 부분 | ✅ | ✅ | ✅ | ❌ |

**OpenCairn 진짜 unique combination — 한 문장**:
"Plate 블록 에디터 + Yjs 협업 + Cytoscape KG 5뷰 + 12 specialized 에이전트 + SM-2 + Deep Research + Synthesis Export(LaTeX/Tectonic) **를 AGPLv3로 한 Docker compose에 묶고 한국어 1급 + Gemini/Ollama BYOK + 3계층 workspace 격리까지 보장**" — 비교 가능한 OSS 제품 0개.

**진짜 갭**: MCP 서버 노출. Notion·Onyx·AnythingLLM은 이미 보유, OpenCairn은 미구현. 다음 plan 0순위.

## §3 직접 경쟁자 정직 분석

### Khoj (이전 라운드 평가 교정)
- **GitHub**: ~33.8k stars, 2.1k forks, 2.0-beta.26 (2026-03-25). 활성.
- **실제 갖춘 것**: 채팅 + 시맨틱 검색 + custom agents(페르소나+도구+KB 단일 모델) + scheduled automations + `/research` + 멀티모달 인덱스(PDF/이미지/MD/Notion/Org/Word).
- **갖추지 못한 것**: 블록 에디터 ❌, Yjs 협업 ❌, 페이지 권한 ❌, KG 시각화 ❌, specialized agent pipeline ❌, SM-2 ❌, Synthesis Export ❌. Notion 통합은 양방향 편집 X, read-only 인덱싱.
- **약점**: 큰 vault OOM(#634, #913), agent 추가 500(#1036), 한국어 UI i18n 없음(추정), 운영 안정성 이슈 누적.
- **포지션**: "AI 보조 두뇌(채팅+검색)"이지 "지식 OS"가 아님. **Notion 대체 축에서는 직접 경쟁자가 아니고 AI 보조 도구로 보완재**.

### Onyx (전 Danswer)
- YC W24, MIT(`onyx-foss`) + EE proprietary 이중 운영. 50+ connector + hybrid search + LLM-generated KG(검색 정확도용) + Agentic RAG + voice + image gen + MCP 서버.
- **에디터·협업·KG 시각화 없음**. 검색 답변 UI 특화. 노트 OS 아님.
- 고객: Netflix·Ramp·Thales 인용. EE에서 SSO/SCIM/RBAC/감사로그 게이팅.

### Notion AI 3.3 (2026-02-24, 가장 위협적인 닫힌 경쟁자)
- **Custom Agents 출시 → 제품 1급 시민으로 격상**. 5/4부터 1,000 credits = $10 사용량 과금.
- **MCP 서버 출시 → 외부 AI에게 read+write 양방향 권한**. Slack/Linear/Figma/HubSpot/Notion Mail/Calendar 연계.
- **Notion이 "agent의 OS가 되겠다"는 베팅** — OpenCairn의 같은 길.
- **OpenCairn 빈자리**: self-host 불가 / BYOK 불가 / PDF·이미지 AI 못 읽음 / 1,000행 한도 / 오프라인 X / EU만 data residency. → 한국 indie/팀이 GDPR·국내망·BYOK·Ollama 동시에 원하면 Notion 답 없음.

### AFFiNE / AppFlowy (노트 OS OSS)
- AFFiNE: 67k stars, 블록 에디터 + 무한 캔버스 + 자체 AI + Docker self-host. 단 RAG/agent orchestration·KG·SM-2·12 agent 없음.
- AppFlowy: 67k stars, Flutter/Rust 네이티브 + 멀티뷰 DB + Ollama 로컬 AI. 단 RAG·Deep Research·KG·학습 없음.
- 둘 다 "Notion-like 에디터 + 가벼운 AI"에 머물러 있고 OpenCairn의 12-agent 깊이를 따라오기 어려운 카테고리.

## §4 한국 시장 — GTM 사실 베이스

### 4.1 규제가 그리는 빈자리

| 규제 | 외산 SaaS 영향 | OpenCairn 적합도 |
|---|---|---|
| 개인정보보호법 2024 (국외이전 동의·자동화 결정 권리) | 외산 LLM 직접 호출 사실상 막힘 | **on-prem Ollama + BYOK + 가명화 = 정답** |
| ISMS-P (5천만~1.5억원, 3년 갱신) | 공공·금융 RFP 실질 필수 | indie 단독 X, 호스팅 법인이 취득 |
| CSAP (공공) | 외산 직접 진입 거의 불가 | 네이버클라우드/NHN/KT 위에 SaaS 표준등급 공동 신청 |
| 망분리 (전자금융감독규정/국정원) | 망 너머 LLM 호출 금지 | **on-prem Ollama 자체 호스팅 = 정답** |
| AI 기본법 2025 (시행령 미확정) | 고영향 AI 영향평가 의무 | OpenCairn 자체는 비대상 추정, 고객사가 평가받기 좋게 로깅·감사·BYOK 노출이 GTM 자산 |

**핵심**: 한국 공공·금융·의료의 **망분리·국외이전 규제는 외산 SaaS 진입을 구조적으로 막고 있으며**, on-prem LLM(Ollama) + BYOK + AGPLv3 self-host는 이 규제 회피의 정답에 가깝다.

### 4.2 AGPLv3 — 양날의 검

- **AGPLv3가 좋은 buyer**: 정부·병원·대학·연구실·EU 데이터 주권 ICP — 신뢰 신호.
- **AGPLv3가 막는 buyer**: 한국 대기업·금융 OSS 정책. 삼성/LG/SK/네이버 등 OSS 위원회 운영하며 GPL/AGPL은 "사전 검토 필수, 수정·재배포·서비스 제공 시 특별 승인" 분류 → 실질적으로 내부 빌드/번들에 넣기 어려움. AGPL은 "네트워크 너머로 서비스 제공"이 배포로 간주되어 직원용 내부 SaaS여도 소스 공개 의무 발생 가능.
- **시사점**: AGPL 단독으로는 한국 대기업 매출 천장 명확 → **dual license + CLA 도입을 코드 베이스 작을 때 미리 깔아두는 것이 가장 큰 ROI**.

### 4.3 한국어 LLM 현황

- 임베딩: 다국어 모델이 영어보다 5~10%p 낮음. **BGE-M3, multilingual-e5-large, ko-sbert** 한국어 retrieval 강세. Gemini embedding-001은 BGE-M3와 근접.
- 생성: **EXAONE 3.0/3.5 (LG, 오픈웨이트)**, **Solar (Upstage, Open Ko-LLM 1위 다수)**, **HyperCLOVA X (네이버)**. 공공·금융 RFP에서 "국산 LLM 우대/의무화" 증가.
- **OpenCairn에 EXAONE/Solar Ollama 프리셋 추가가 한국 GTM의 결정적 무기** — 현재 미적용.

### 4.4 한국 buyer 인식 변화 (2023→2026)

- 2023: OSS = "무료지만 책임 떠안기 싫다", BYOK 개념 거의 모름.
- 2026: ChatGPT 충격 + 데이터 유출 공포 + 망분리 LLM 수요 폭증으로 **on-prem LLM·BYOK·private LLM** 인식 급상승. NHN/KT/네이버 모두 "프라이빗 LLM" 마케팅 강화.
- **한국 SaaS 평균 ACV**: SMB 연 100~1,000만원, 대기업 5,000만~수억. 결제 세금계산서 + 후불 30~60일 기본. 영업 사이클 SMB 1~3개월, 엔터프라이즈 6~12개월.

## §5 OSS 상용화 — 모방 대상 분석

### 5.1 success trajectory benchmarks

| 회사 | 라이선스 | 모델 | 최신 ARR | 시사점 |
|---|---|---|---|---|
| **Plausible** | AGPLv3 | 8~10명, bootstrapped, hosted-only paid | $1M+ (2022, 추정 더 성장) | **OpenCairn 1:1 매칭. 가장 깨끗한 모방 대상.** |
| **Cal.com** | AGPLv3 + 1% `/ee` closed | open core lite, Series A funded | 추정 $1.1M/yr | dual license 옵션 살리는 패턴 |
| **n8n** | fair-code (self-host 무료) | Cloud + EE + embedded | $40M (2025-07, 5x YoY) | LLM 워크플로우 = OpenCairn agent runtime 카테고리 |
| **Dify** | Apache-2 | self-host 무료 + Pro $59/mo flat | 미공개 | Pro tier 가격 디자인 직접 참조 |
| **Supabase** | Apache-2 | hosted 중심 | $70M (2025-Q3, +250% YoY) | AI 시대 인프라 BaaS, 230명 팀 — 다른 리그 |
| **PostHog** | MIT | usage-based + 관대한 free tier | 수십 M | 98% free tier — funnel 디자인 참조 |
| **AppFlowy** | OSS | 시드 $6.4M 후 매출 미공개 | — | 펀딩 받았지만 매출 공개 없음 |

### 5.2 AGPLv3 상용화 정형 3가지

1. **Hosted-only paid** (Plausible) — 라이선스는 손대지 않고 **운영가치로 마진**. 가장 indie 친화. AI 비용은 BYOK로 buyer에게 전가.
2. **Open core / EE split** (Cal.com `/ee` 1%, Grafana Enterprise) — 99% AGPL + SSO·SCIM·SLA·audit log를 별도 commercial.
3. **Dual license** (MongoDB·Qt 전통) — AGPL과 commercial을 동일 코드에 양쪽 부여, copyleft 못 쓰는 buyer가 commercial 키 구매. **CLA 필수**.

**1인 indie OpenCairn에 권장**: P1(Plausible 모델 정직 복제) + P2(`/ee` 1% 분리 + CLA를 미리 깔아두기) + 시간이 가면 P3(dual license)로 확장.

### 5.3 self-host → hosted conversion 현실

- 산업 통설 [추정]: self-host 사용자의 1~5%만 hosted로 전환.
- 마진은 거의 100% **운영가치** (백업·업그레이드·SSO·SCIM·SLA·priority support·관리형 LLM 키).
- AI 시대 추가 변수: **BYOK 강제로 LLM 토큰비를 buyer에게 전가** (JetBrains·Warp·Cursor 채택). hosted SaaS는 운영가치만 청구. OpenCairn ICP의 60%+가 BYOK 친화 segment(데이터 주권·기존 LLM 협상가·GPU 자체 보유) [추정].

### 5.4 OSS GTM funnel

GitHub stars → HN/Reddit/Product Hunt 1회 spike → docs 조회 → self-host trial → Discord/Slack 진입 → hosted 전환 또는 enterprise 영업.

핵심 KPI = **stars 아니라 weekly active self-host instance 수**. ROSS Index가 분기 OSS startup ranking을 stars 성장률로 추적.

커뮤니티 채널: **Discord가 indie OSS 사실상 표준**. Slack은 enterprise 영업 전용. Discourse는 KB/long-form. 70/30 룰 (도움 70% / 홍보 30%).

## §6 종합 평가 — OpenCairn은 경쟁력이 있는가

### 진짜 경쟁력 있는 곳

1. **두 축 동시 점유**: 노트 OS(Notion-like) + AI/RAG/agent 깊이를 단일 OSS로 묶은 제품이 시장에 0개 — Khoj·Onyx·AFFiNE 어느 쪽도 다른 축의 깊이를 따라올 카테고리 능력이 약함.
2. **한국 규제 정합**: 망분리 + 국외이전 규제 + on-prem Ollama + BYOK + AGPLv3 self-host가 정확히 정합. 외산 SaaS가 구조적으로 진입 못 하는 슬라이스(공공·금융·의료·교육·연구실)에서 무경쟁.
3. **Notion이 못 주는 것**: self-host / BYOK / AGPLv3 / 한국어 1급 / 오프라인 / 12 specialized agent — 모두 Notion 한계가 곧 OpenCairn 빈자리.
4. **Plausible 직계 모방 가능성**: AGPLv3 + indie + bootstrapped + hosted-only paid 모델이 카테고리만 다를 뿐 1:1 매칭. 검증된 sustainability path.

### 솔직히 위태로운 곳

1. **Notion이 빠르게 추격 중** — Custom Agents + MCP server + Mail/Calendar 통합으로 "agent OS"로 이동. 1년 안에 OpenCairn의 차별화 일부(특히 agent orchestration 깊이)가 따라잡힐 수 있음. **속도 경쟁**이 진짜 변수.
2. **AGPLv3 한국 대기업 천장** — dual license + CLA를 미리 깔지 않으면 enterprise 매출이 자연 capped됨.
3. **혼자 12 agent × N provider 운영의 quality assurance 부채** — SDK breaking change 마다 부담. eval CI + observability(Langfuse/LangSmith 영감) 없으면 깊이가 곧 부채로 전환.
4. **MCP server 노출 갭** — Onyx/AnythingLLM/Notion 모두 보유, OpenCairn 미보유. 1년 차이가 분산 채널 결정적 차이로 벌어짐.

### 절대 안 되는 곳

1. **글로벌 Glean 잡기 게임** — ARR $200M 100-seat min은 다른 리그. 처음부터 목표 아님.
2. **SOC2/ISO27001 대형 enterprise procurement** — indie 1인이 받기 비현실적, AGPLv3 자동 reject 정책에 묶임.
3. **사용자 자체 만들기 경쟁** — 자본·인력·marketing 게임 포기.

### 결론 — 짧게

**좁은 슬라이스에서 진짜 경쟁력 있음. 단, 3가지 결정이 향후 12개월 안에 박혀야 함**:

1. **MCP server 노출 (read-only Phase 1)** — Notion/Onyx 따라잡기. 다음 plan 0순위.
2. **dual license + CLA를 코드 베이스 작을 때 미리** — 한국 대기업 천장 풀기 위한 가장 저비용 옵션.
3. **EXAONE/Solar Ollama 프리셋** — 한국 GTM 결정적 무기, 일주일 단위 작업.

위 3가지가 박히면 Plausible 직계 indie path로 24개월 내 hosted ARR ₩60M~₩300M 도달 합리적 [추정]. 박히지 않으면 Notion 추격에 따라잡혀 차별화 1~2년 안에 약화.

---

## §7 12개월 권장 진입 시퀀스 (제안)

> 의사결정 자료이지 plan 아님. 정식 진입은 brainstorming 사이클 후.

| 시점 | 작업 | 근거 |
|---|---|---|
| 즉시 (현재 병렬 세션 종료 후) | **MCP server read-only Phase 1** (`search_notes` 하이브리드 + `get_note` + `list_projects`, OAuth 2.1 + workspace-scope 토큰) | §6.1, §3 Notion MCP 따라잡기, §2 매트릭스 갭 |
| +1주 | **EXAONE 3.5 / Solar / HyperCLOVA Ollama 프리셋** + 임베딩 BGE-M3 옵션 | §4.3 한국 GTM 결정적 |
| +2주 | **CLA 도입 + `/ee` 1% 디렉터리 분리** (closed 1%는 비워두고 inbound 발생 시 채움) | §5.2 P2, §4.2 한국 대기업 천장 |
| +1개월 | **Claude Code Skill 패키지 + Anthropic Skills 마켓 등록** (Codex/Cursor도 동일 spec → multi-platform) | §A.2 ai-native-research, §6.4 분산 |
| +2개월 | **MCP server write Phase 2** (`create_note`, `start_research` 등) | Notion MCP 패리티 |
| +3개월 | **Hosted billing engine + hosted tier 첫 출시** ($9~19/user/mo flat + BYOK 기본) | §5.1 Plausible 모델 |
| +6개월 | **Discord 커뮤니티 + 한국어/영어 콘텐츠 동시 운영** + HN/Product Hunt 1회 spike | §5.4 funnel |
| +9~12개월 | **CSAP 파트너 IaaS(NHN/네이버클라우드) + ISMS-P 호스팅 법인 취득 검토** | §4.1 공공 진입, ARR 견인 시점에만 |

## §8 핵심 출처

### 직접 경쟁자
- [Khoj GitHub](https://github.com/khoj-ai/khoj) · [Releases](https://github.com/khoj-ai/khoj/releases) · [docs all-features](https://github.com/khoj-ai/khoj/blob/master/documentation/docs/features/all-features.md) · [Notion 통합](https://docs.khoj.dev/data-sources/notion_integration/)
- [Onyx GitHub](https://github.com/onyx-dot-app/onyx) · [Onyx pricing](https://onyx.app/pricing) · [TechCrunch 2025-03](https://techcrunch.com/2025/03/12/why-onyx-thinks-its-open-source-solution-will-win-enterprise-search/)
- [AnythingLLM Agent Flows](https://docs.anythingllm.com/agent-flows/getting-started)
- [AFFiNE vs AppFlowy 2026](https://affine.pro/blog/affine-vs-appflowy-vs-anytype)
- [Notion 3.3 release](https://www.notion.com/releases/2026-02-24) · [Notion MCP](https://developers.notion.com/guides/mcp/mcp) · [Notion data residency](https://www.notion.com/help/data-residency)

### 한국 시장·규제
- 개인정보보호위원회 — `pipc.go.kr` (개정법 안내)
- KISA ISMS-P — `isms.kisa.or.kr`
- NIPA CSAP — `cloud.go.kr`
- 금융위 망분리 개선 로드맵 (2024-08, `fsc.go.kr`)
- 과기정통부 AI 기본법 (2024-12, `msit.go.kr`)
- 삼성 OSS — `opensource.samsung.com` · LG OSS — `opensource.lge.com`
- Open Ko-LLM Leaderboard — `huggingface.co/spaces/upstage/open-ko-llm-leaderboard`
- 업스테이지 Solar — `upstage.ai` · LG EXAONE — `lgresearch.ai` · 네이버 HyperCLOVA X — `clova.ai`

### OSS 상용화
- [Plausible Wikipedia](https://en.wikipedia.org/wiki/Plausible_Analytics) · [Indie Hackers Plausible](https://www.indiehackers.com/product/plausible-insights/revenue)
- [Cal.com Tracxn](https://tracxn.com/d/companies/calcom/__IEeuL9zwIQRcTDpJAAntiwKZ0CItPOOlE9FD_QgbF4o)
- [Sacra n8n](https://sacra.com/c/n8n/) · [Sacra Supabase](https://sacra.com/research/supabase-at-70m-arr-growing-250-yoy/) · [Sacra PostHog](https://sacra.com/c/posthog/)
- [Dify GitHub](https://github.com/langgenius/dify)
- [SSPL Wikipedia](https://en.wikipedia.org/wiki/Server_Side_Public_License) · [Sentry FSL](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/) · [Armin: FSL vs AGPL](https://lucumr.pocoo.org/2024/9/23/fsl-agpl-open-source-businesses/)
- [JetBrains BYOK](https://blog.jetbrains.com/ai/2025/12/bring-your-own-key-byok-is-now-live-in-jetbrains-ides/) · [OpenRouter BYOK](https://openrouter.ai/docs/guides/overview/auth/byok)
- [ROSS Index](https://runacap.com/ross-index/)

## §9 본 리서치의 한계

- 한국 시장 통계는 부분적으로 추정·인상에 의존 (subagent 환경의 라이브 페치 제한). 1차 출처 재확인 필요.
- ISMS-P 비용·CSAP 파트너십 조건·AI 기본법 시행령 세부는 분기 변동 — 결정 시점 재확인.
- Khoj/Onyx의 funding·매출 일부는 paywall 뒤 — Crunchbase/Pitchbook 유료 자료 확인 시 보정 가능.
- 본 문서는 의사결정 자료이며 plan/spec/계약서가 아님.
