# AI-Native Ecosystem Research — 2026-04-30

> 사용자가 "그냥 리서치만 해줘 — Company Brain · Software for Agents · MCP · Claude Code Skills · ChatGPT
> Connectors 등등" 요청. 두 subagent(claude-code-guide + Trend Researcher) 병렬 조사 결과를 종합.
> 후속 의사결정의 사실 베이스로 사용. **이건 plan/spec 아님.**

## A. 기술 표준 — 지금 진짜 어떻게 돌아가는가

### A.1 MCP (가장 중요)
- Stable spec **`2025-11-25`**. 3 서버 기능: Resources(RAG-style 데이터) / Tools(side-effect 함수) / Prompts(task 템플릿).
- **인증**: OAuth 2.1 + Protected Resource Metadata + OpenID Connect가 Nov 2025부터 표준화. 사용자별 토큰 부여가 spec 레벨에서 정착.
- **Transport**: stdio(local) + Streamable HTTP(remote). Remote hosted 사례 폭증 — Notion / Linear / Atlassian / Sentry / GitHub / Slack / Stripe / Asana / Block / Intercom / PayPal / Webflow 모두 공식 remote MCP 서버 출시 (Cloudflare MCP Demo Day가 분기점).
- **2026 로드맵**: horizontal scaling + enterprise readiness.

### A.2 Claude Code Skills
- 포맷: `~/.claude/skills/<name>/SKILL.md` (YAML frontmatter + Markdown body + 보조 파일).
- 배포: 파일/디렉터리 / Plugin 패킹 / Marketplace 등록 / Managed settings.
- **2025-12 "Agent Skills" open spec → OpenAI Codex CLI/ChatGPT, Cursor, Gemini CLI 등 12개 도구 채택**. 더 이상 Claude 전용 아님.
- Skill ≠ MCP: Skill은 prompt-based playbook (instruction), MCP는 JSON-RPC 도구 프로토콜. **상호보완**.

### A.3 Codex / OpenAI
- Codex CLI도 Dec 2025부터 MCP + Agent Skills 1급 지원. **OpenAI Apps SDK = MCP 확장**.
- ChatGPT Connectors/Apps는 별도 closed 통합이지만 백엔드는 MCP에 수렴 중.

### A.4 에이전트 친화 API 디자인 패턴
- Schema-first(OpenAPI + agent metadata extension), cursor-based pagination(per-page 200+), `X-RateLimit-*` 헤더 노출, idempotency key, machine-readable error code, AGENTS.md/llms.txt 메타 표준.

### A.5 외부 SaaS의 MCP 서버 인증 패턴

| 서비스 | 인증 | scope |
|---|---|---|
| Notion / Atlassian / Linear / Slack / Sentry / GitHub | OAuth 2.1 강제 | read+write |
| Stripe | API key | API+KB |

**bearer 토큰 단독 허용은 사라지는 추세**. OAuth 2.1이 사실상 의무.

## B. 시장 — 누가 무엇을 만들고 있나

### B.1 Company Brain 카테고리 지도

| 진영 | 대표 | 포지션 | 약점 |
|---|---|---|---|
| Closed enterprise | **Glean** ($7.2B, ARR $200M, 100-seat min, $50+/u/mo) | Work AI + Knowledge Graph | 가격 불투명, 진짜 self-host 없음, SMB 진입 불가 |
|  | **Sana** (Stockholm, $13/u 300-license min) | "Superintelligence for work" | SaaS-only |
|  | **Dust.tt** (YC W23, 30+ connector) | Enterprise OS for AI agents | Data residency 약함 |
|  | **Aily Labs** | 수직 (pharma/BFSI) | 일반 KMS 아님 |
| Closed PKM | Mem.ai · Reflect · Capacities | 개인 second brain | 팀/엔터프라이즈 X |
| **OSS self-host** | **Onyx** (전 Danswer, MIT, YC W24, 40+ connector, BYOK) | 가장 강한 직접 경쟁 OSS | chat 중심, editor·collab 없음 |
|  | **AnythingLLM** (54k★ MIT) | desktop+docker, BYOK | 깊이 얕음 |
|  | **Khoj** (AGPLv3, MCP+deep research+40 connector, multi-LLM) | **OpenCairn과 가장 직접 경쟁** | editor·KG·document studio 빈약 |
| 인프라화 | Microsoft IQ (Work/Fabric/Foundry, Ignite 2025) · Stack Internal (2025-11) · Vellum/Vapi/LiveKit | "Single intelligence layer" 명시 | 자체 호스팅 X |

**핵심**: "분산 지식 → single intelligence layer" + **self-host + workspace isolation + multi-LLM + editor 통합**의 5중 조합을 단일 OSS 제품으로 묶은 선례는 사실상 **없음**. Notion+Onyx+Khoj DIY 조합 사용자가 통합 제품을 기다림.

### B.2 MCP 서버 마켓플레이스 규모
- **Glama 22,470 servers**, mcp.so 17,186, Smithery 2,880 verified.
- Anthropic Skills 공식 + 커뮤니티 (SkillsMP, claudeskills.info, awesome-claude-skills 140+).
- **하지만 "도메인 비즈 노하우 skill"의 대규모 채택은 약함** — 코딩·파일변환에 집중. 비즈 노하우는 long tail.

## C. OpenCairn 의사결정에 직결되는 함의

### C.1 Risk (3개)
1. **Onyx + Khoj가 OSS Company Brain에 이미 자리잡음** — 후발이라 차별화(KG · staged AI workflows · editor 통합 · 한국어 1급)를 강하게 내세우지 않으면 "또 하나의 second brain"으로 묻힘.
2. **MCP/Skill 노출은 양날** — 외부 harness 호출 가능해지는 순간 자체 UI lock-in 약화. Notion도 같은 딜레마.
3. **Multi-LLM 운영 부채** — provider 추상화는 SDK breaking change마다 손가고, 여러 AI workflow와 provider 조합의 QA는 indie 인력으로 한계.

### C.2 Leverage (3개)
1. **Self-host + workspace isolation + AGPLv3 + BYOK + 한국어 1급** 5중 조합 동시 만족 경쟁자 0. 한국 공공·교육·연구실·법무·의료 niche 무경쟁.
2. **AI workflow + KG + Editor 단일 product** — Onyx(chat) + Notion(editor) + Glean(KG) + Anki(learning) DIY 통합 비용 0.
3. **MCP 서버로 OpenCairn 자체를 노출 → ChatGPT/Cursor/Claude/Codex 사용자의 self-host backing store** 가 됨. **Notion MCP의 OSS+self-host 대안 자리는 현재 비어있음**.

### C.3 진입 우선순위 (기술적)
- **Tier 1 (작고 ROI 큼)**: 공개 contributor guide 기반의 `opencairn` coding-assistant skill 패키지. Codex/Cursor/Claude 계열 도구가 같은 public guide를 읽도록 맞춘다.
- **Tier 2 (장기 표준)**: MCP 서버 (read-only Phase 1 → write Phase 2). OAuth 2.1 + workspace-scope 토큰. `mcp.opencairn.example.com` remote hosting + stdio 로컬 모두.
- **Tier 3 (차별화)**: "decision trace" 1급 객체화 — Glean Knowledge Graph가 닿지 못한 영역(환불/인시던트/예외 결정 경로)을 12-agent + KG + provenance로 표상.

## D. 한 줄 결론

**MCP 서버 + Agent Skill 패키지** 두 트랙 모두 기술 표준이 안정화됐고 시장 자리는 비어있음. **Khoj가 가장 직접 경쟁자**라는 점만 분명히 인지하고 진입하면 됨. 영감 메모는 이미 박제(`docs/architecture/ai-native-positioning-notes.md`)했고, 실제 진입은 현재 병렬 세션(H6 + Plan 2E Phase B) 종료 후 brainstorming.

## E. 핵심 출처

### 기술
- MCP Spec 2025-11-25 — https://modelcontextprotocol.io/specification/2025-11-25
- MCP 2026 Roadmap — https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
- Claude Code Skills — https://code.claude.com/docs/en/skills.md
- Agent Skills 공동 spec — https://agentskills.io
- Anthropic Skills GitHub — https://github.com/anthropics/skills
- OpenAI Codex Apps SDK — https://developers.openai.com/codex/sdk
- Notion MCP — https://developers.notion.com/docs/get-started-with-mcp
- Cloudflare MCP Demo Day — https://blog.cloudflare.com/mcp-demo-day/

### 시장
- Glean $7.2B Series F (TechCrunch) — https://techcrunch.com/2025/06/10/enterprise-ai-startup-glean-lands-a-7-2b-valuation/
- Glean ARR $200M — https://futurumgroup.com/insights/glean-doubles-arr-to-200m-can-its-knowledge-graph-beat-copilot/
- Onyx GitHub (전 Danswer) — https://github.com/onyx-dot-app/onyx
- Khoj GitHub (AGPLv3) — https://github.com/khoj-ai/khoj
- Sana Labs pricing — https://sanalabs.com/products/sana-learn/pricing
- Atlassian Remote MCP — https://github.com/atlassian/atlassian-mcp-server
- Slack MCP official — https://docs.slack.dev/ai/slack-mcp-server/
- ChatGPT Connectors/Apps — https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
- Microsoft IQ (Ignite 2025) — https://jannikreinhard.com/2025/11/26/microsoft-iq-the-intelligence-layer-that-finally-makes-ai-agents-useful/
- Stack Internal — https://stackoverflow.blog/2025/11/18/introducing-stack-internal-powering-the-human-intelligence-layer-of-enterprise-ai/
- Glama MCP registry (22.4k servers) — https://glama.ai/mcp/servers

## F. 조사 메서드
- Subagent 1 (claude-code-guide): MCP 스펙 / Claude Code Skills / Codex / API 디자인 — context7 SDK 문서 + WebFetch.
- Subagent 2 (Trend Researcher): Company Brain 시장 / SaaS MCP 서버 / 마켓플레이스 / 인프라화 사례 — WebSearch + WebFetch.
- 두 보고서를 메인 세션에서 종합 후 본 문서로 정리.
