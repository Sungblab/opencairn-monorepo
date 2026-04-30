# AI-Native Positioning — Inspiration Notes (2026-04-30)

> 외부 에세이("AI 네이티브 서비스 기업 / Company Brain / 에이전트를 위한 소프트웨어 / 기업용 AI OS" 6 테마)
> 를 읽고 OpenCairn 포지셔닝에 박아둘 만한 통찰을 메모. **이건 plan도 spec도 아님.**
> 정식 작업 진입 시 brainstorming → spec → plan 사이클로 다시 진입.

## 우리가 이미 그 자리에 서 있는 두 테마

### 1. Company Brain
- 분산 소스(이메일·Slack·티켓·DB·논문·웹) → ingest → enrichment(note_enrichments) → KG → 에이전트가 쿼리/실행
  가능한 "살아있는 지도"가 핵심. 단순 검색·문서 챗봇이 아니라 **운영 방식 자체의 표상**.
- OpenCairn은 이미 ingest 8 activity + 12 agent + KG Phase 1·2 + Synthesis/Curator/Connector/Staleness/Narrator
  까지 갖춰 Personal Brain으로는 작동 가능. **Team Brain으로 확장**할 때 진짜 그림이 됨.
- 미진한 부분: 운영 의사결정 트레이스(환불 예외·인시던트 대응 등)를 캡처할 connector가 아직 없음.
  Plan 8 Connector Foundation의 후속이 여기서 의미를 가짐.

### 2. Software for Agents
- 인터넷 다음 1조 사용자는 사람이 아닌 에이전트. Forms·dashboard 대신 API/MCP/CLI 일급 시민화.
- OpenCairn은 이미 MCP **클라이언트**(Phase 1, main `1a36177`) — 외부 MCP 서버를 ToolDemoAgent에서 사용.
- **반대 방향(MCP 서버) 은 미구현** — OpenCairn 지식을 Claude Code/Codex/Cursor에서 직접 쿼리하게 하는 길.
  scope=workspace 토큰 + read-first(`search_notes` 하이브리드 + `get_note` + `list_projects`) →
  Phase 2에 쓰기(`create_note`, `start_research`).

## 두 테마는 사실 같은 레이어

핵심 통찰: Company Brain은 **에이전트가 쿼리할 수 있어야** 비로소 살아있는 지도가 됨. 그렇지 않으면
또 하나의 검색 UI일 뿐. 즉 MCP 서버는 단순 "통합 기능"이 아니라 **포지셔닝 결정**.

| 측면 | Company Brain only | + Software-for-Agents (MCP 서버) |
|---|---|---|
| 사용자 surface | OpenCairn 자체 채팅·에디터 | + Claude Code/Codex/Cursor/임의 에이전트 하니스 |
| 가치 위치 | 내부 UX 품질 | ingest+enrichment 파이프라인 자체 (UX는 부수) |
| Moat | 에디터·검색·KG 시각화 | 누가 ingest 했는지가 곧 누가 지식을 갖는지 |
| 카니발라이제이션 위험 | 낮음 | 자체 채팅 사용량 일부 잠식 가능 |
| 대응 | — | 우리 가치는 채팅 surface 아니므로 분산 > 집중. Notion도 같은 결론. |

## 영감만 되고 우리 스코프 아닌 테마

| 테마 | 왜 우리 일이 아닌가 |
|---|---|
| AI-native 의료 | OSS 인디 Solo/Team OS 스코프 밖. 데이터·규제 갈래 다름. |
| SaaS 챌린저 (ERP·EDA·산업제어) | 동의는 하지만 우리 시장 아님. |
| Dynamic software interfaces (개인화 UI) | 흥미롭지만 OpenCairn은 공유 프리미티브 측에 가깝고, 사용자별 UI 변형은 후순위. |
| 기업용 AI OS (closed-loop) | 부분적으로만 — Synthesis/Connector 라인 위에 spec 필요. |

## 행동 가능한 것 (정식 plan 진입 시점)

1. **MCP 서버** — read-only Phase 1 (`search_notes` + `get_note` + `list_projects` + workspace-scope 토큰).
   현재 Plan 9b 이전 시점에서도 가능. spec 자료는 이미 충분.
2. **Tool Template 공개 포맷** — Plan 6의 `packages/templates`를 외부 에이전트가 import 할 수 있는
   "skill file" 포맷(MCP prompt resource? AGENTS.md 표준? Claude Code skill?)으로 정리.
   에세이의 "원시 노하우 → 스킬 파일" 메타포와 직결.
3. **Closed-loop connector 확장** — 회의 녹화·티켓·인시던트 트레이스를 ingest 한 뒤 Synthesis 가
   "산출물 ↔ 의도 차이"를 자동 플래그하는 루프. Plan 8 Connector Foundation 위 후속 spec.

## 현실 체크

- 위 3개 모두 **현재 진행 중인 두 병렬 세션(H6 + Plan 2E Phase B) 이후** 진입 가능.
- 1번이 가장 작고 가장 큰 포지셔닝 효과 — 다음 plan 후보 0순위로 박아둠.
- 2·3번은 1번 머지 후 brainstorming 필요.

## 출처
- 외부 에세이 (2026-04-30 사용자 공유), 제목 미상.
- 사내 연관 자료: `docs/architecture/agent-platform-roadmap.md`,
  `docs/superpowers/specs/2026-04-09-opencairn-design.md`,
  `docs/superpowers/specs/2026-04-20-agent-runtime-standard-design.md`.
