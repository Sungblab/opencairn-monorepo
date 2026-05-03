# Agent System Claim Audit — 2026-05-03

Purpose: verify whether OpenCairn's "12 agents" claim maps to real runtime agents, public entry points, tools, and product behavior.

This is a claim-vs-code audit, not a product roadmap. Treat "agent" as overloaded in this repo:

- Marketing/design agent: a named role in docs or landing copy.
- Runtime agent: subclass of `apps/worker/src/runtime/agent.py` `Agent`.
- Workflow-backed agent: a Temporal workflow/activity pair that invokes agent-like code.
- Product agent: a feature a user can discover and run from the app.
- Tool-loop agent: code using `runtime.loop_runner.run_with_tools` / `ToolLoopExecutor`.

## Executive Summary

The current codebase does not support the simple statement "there are 12 production runtime agents" without qualification.

- The original 12-agent list exists in `docs/superpowers/specs/2026-04-09-opencairn-design.md` and `docs/agents/agent-behavior-spec.md`.
- The app landing page repeats the 12-agent framing in `apps/web/messages/{ko,en}/landing.json`.
- The actual worker has 9 `runtime.Agent` subclasses among the original 12 names:
  - Compiler
  - Research
  - Librarian
  - Connector
  - Curator
  - Synthesis
  - Narrator
  - Staleness, the implementation name for Temporal Agent
  - DocEditor, not part of the original 12
- Visualization is agent-like and uses the new tool loop, but it is not a `runtime.Agent` subclass.
- Code Agent is explicitly not a `runtime.Agent` subclass.
- Deep Research has a workflow/activity pipeline but no `DeepResearchAgent` class.
- Socratic has workflows and activities, but no `SocraticAgent` class under `worker/agents`.
- The project `/agents` UI only exposes 5 Plan 8 agents: synthesis, curator, connector, staleness, narrator.
- The tool-loop design is not consistently applied to all agents. Most older agents manually emit `ToolUse` / `ToolResult`; only Visualization and DocEditor RAG paths are on `run_with_tools`.

So the truthful current claim is closer to:

> OpenCairn has a 12-role agent design, several workflow-backed agent features, and a smaller set of actual runtime/tool-loop agents. The 12-role system is not yet one uniform, discoverable, tool-orchestrated production platform.

## Evidence Checked

Primary paths:

- `docs/agents/agent-behavior-spec.md`
- `docs/superpowers/specs/2026-04-09-opencairn-design.md`
- `docs/architecture/agent-platform-roadmap.md`
- `apps/worker/src/runtime/agent.py`
- `apps/worker/src/runtime/tools.py`
- `apps/worker/src/runtime/loop_runner.py`
- `apps/worker/src/worker/temporal_main.py`
- `apps/worker/src/worker/agents/**`
- `apps/worker/src/worker/workflows/**`
- `apps/worker/src/worker/activities/**`
- `apps/api/src/app.ts`
- `apps/api/src/routes/{synthesis,curator,connector,narrator,staleness,socratic,research,visualize,code}.ts`
- `apps/api/src/routes/plan8-agents.ts`
- `apps/web/src/components/views/agents/agent-entrypoints-view.tsx`
- `apps/web/messages/{ko,en}/{landing,agents}.json`

Commands used:

```powershell
rg -n "class .*Agent\(|extends Agent|runtime.Agent|Agent\)" apps\worker\src packages apps\api\src --glob "!**/__pycache__/**"
rg -n "workflow\.start\(\"(CompilerWorkflow|ResearchWorkflow|LibrarianWorkflow|CuratorWorkflow|ConnectorWorkflow|StalenessWorkflow|NarratorWorkflow|SynthesisWorkflow|DeepResearchWorkflow|CodeAgentWorkflow|VisualizeWorkflow|SocraticGenerateWorkflow|SocraticEvaluateWorkflow)" apps\api\src apps\web\src
rg -n "run_with_tools|ToolLoopExecutor\(|ToolContextRegistry|ToolDemoAgent|tool_demo" apps\worker\src apps\worker\tests packages\llm\src --glob "!**/__pycache__/**"
rg -n "FEATURE_CODE_AGENT|FEATURE_DEEP_RESEARCH|FEATURE_DOC_EDITOR_SLASH|FEATURE_DOC_EDITOR_RAG|FEATURE_SYNTHESIS_EXPORT" .env.example apps docs --glob "!**/node_modules/**"
```

## 12-Agent Matrix

| Claimed agent | Runtime `Agent` subclass? | Temporal workflow? | Public/API entry? | Product discoverability | Tool-loop status | Current assessment |
| --- | --- | --- | --- | --- | --- | --- |
| Compiler | Yes: `CompilerAgent` | Yes: `CompilerWorkflow` | Internal trigger from ingest via `/api/internal/notes` with `triggerCompiler` | Indirect via ingest, not a user-facing agent card | Manual `ToolUse` / `ToolResult`, not `run_with_tools` | Real backend agent, not a standalone product agent |
| Research | Yes: `ResearchAgent` | Yes: `ResearchWorkflow` | No direct public route found for `ResearchWorkflow`; chat now uses API-side `chat-llm` retrieval instead | Chat surfaces exist, but not this worker agent as a product entry | Manual events, not `run_with_tools` | Runtime agent exists, product path appears mostly bypassed by newer chat stack |
| Librarian | Yes: `LibrarianAgent` | Yes: `LibrarianWorkflow` | No user-facing route found in current API scan | Not discoverable as run button | Manual events, not `run_with_tools` | Backend maintenance agent exists, product surface weak/implicit |
| Connector | Yes: `ConnectorAgent` | Yes: `ConnectorWorkflow` | Yes: `/api/connector/run` | Yes in project `/agents` page | Manual events, not `run_with_tools` | Real but narrow suggestion producer |
| Socratic | No `worker/agents/socratic` class | Yes: `SocraticGenerateWorkflow`, `SocraticEvaluateWorkflow` | Yes: `/api/projects/:projectId/socratic/*` | Yes under learn/socratic | Activity functions, not `runtime.Agent` | Product feature exists, but "agent" is mostly naming around activities |
| Temporal | Yes as `StalenessAgent`, not `TemporalAgent` | Yes: `StalenessWorkflow` | Yes: `/api/agents/temporal/stale-check` | Yes in project `/agents` page as Staleness | Manual events, not `run_with_tools` | Real staleness checker, name drift from Temporal Agent |
| Synthesis | Yes: `SynthesisAgent` | Yes: `SynthesisWorkflow` | Yes: `/api/synthesis/run` | Yes in project `/agents` page | Manual events, not `run_with_tools` | Real but separate from multi-format Synthesis Export |
| Curator | Yes: `CuratorAgent` | Yes: `CuratorWorkflow` | Yes: `/api/curator/run` | Yes in project `/agents` page | Manual events, not `run_with_tools` | Real but narrow suggestion producer |
| Narrator | Yes: `NarratorAgent` | Yes: `NarratorWorkflow` | Yes: `/api/narrator/run` | Yes in project `/agents` page | Manual events, not `run_with_tools` | Real but depends on provider/TTS path and audio persistence |
| Deep Research | No `DeepResearchAgent` class | Yes: `DeepResearchWorkflow` | Yes: `/api/research/*` when flag enabled | Yes via research routes/sidebar when flag enabled | Activity pipeline, not `runtime.Agent` | Real workflow-backed feature, not a runtime agent |
| Code | No; explicitly not `runtime.Agent` | Yes: `CodeAgentWorkflow` when flag enabled | Yes: `/api/code/*` when `FEATURE_CODE_AGENT=true` | Canvas panel when enabled | One-shot `generate_with_tools` sentinel tool, not tool loop | Product feature behind flag, not a standard agent |
| Visualization | No; `VisualizationAgent` is a plain class | Yes: `VisualizeWorkflow` | Yes: `/api/visualize` | Yes through graph visualization dialog/path | Uses `run_with_tools` | Strong tool-loop implementation, but not `runtime.Agent` subclass |

## Additional Agent-Like Code Not In Original 12

| Name | Reality |
| --- | --- |
| DocEditorAgent | Real `runtime.Agent` subclass. Powers `/improve`, `/translate`, `/summarize`, `/expand`, and RAG commands when flags are enabled. This is arguably more "agentic" than several original 12 items, but not in the original marketing list. |
| SynthesisExportAgent | Explicitly not `runtime.Agent`. One-shot structured-output writer for multi-format export. Feature is behind `FEATURE_SYNTHESIS_EXPORT=false` by default. |
| ToolDemoAgent | Test/demo harness for tool-loop verification. Not production product surface. |

## Main Claim Gaps

### 1. "All 12 agents subclass runtime.Agent" is false

`docs/agents/agent-behavior-spec.md` says every agent subclasses `runtime.Agent`. Current code contradicts that:

- `CodeAgent` says explicitly that it is not a `runtime.Agent` subclass.
- `SynthesisExportAgent` says explicitly that it mirrors CodeAgent and is not a `runtime.Agent`.
- `VisualizationAgent` is a plain class using `run_with_tools`, not a subclass.
- Deep Research and Socratic are workflow/activity systems, not `Agent` subclasses.

### 2. "12 production agents" is not the same as "12 product entry points"

The project agents page is implemented at `apps/web/src/components/views/agents/agent-entrypoints-view.tsx`.

It hardcodes:

```ts
const LAUNCH_ORDER = [
  "synthesis",
  "curator",
  "connector",
  "staleness",
  "narrator",
];
```

The matching overview route `apps/api/src/routes/plan8-agents.ts` also hardcodes the same five `PLAN8_AGENT_NAMES`.

That page does not expose Compiler, Research, Librarian, Socratic, Deep Research, Code, or Visualization.

### 3. "Tool design" is uneven

The repo has a proper tool abstraction:

- `@tool`
- `ToolContext`
- allowed agent/scope checks
- `ToolLoopExecutor`
- `run_with_tools`

But most original agents are not actually using the new loop. They manually emit tool events and call provider/API helpers directly. The strongest current tool-loop users are:

- Visualization
- DocEditor RAG commands
- ToolDemoAgent tests

Code and Synthesis Export use a single sentinel `emit_structured_output` tool, but do not execute a multi-turn tool loop.

### 4. The 12-agent marketing copy overstates current product reality

`apps/web/messages/ko/landing.json` and `apps/web/messages/en/landing.json` present "12 agents" as a major first-viewport/product claim. The Korean copy includes lines like:

- "12개의 AI 에이전트"
- "12 에이전트 백본"
- "12명의 전문가가 분업합니다"
- "12 에이전트가 주제별 위키 초안을 작성합니다"

The implementation is more nuanced:

- Some roles are implemented indirectly.
- Some are flag-gated.
- Some are backend-only.
- Some are not runtime agents.
- Some are not discoverable in the product.
- Some are maintenance workflows rather than user-facing agents.

### 5. Agent necessity is questionable for several roles

Some roles are real domain features, but not necessarily separate agents:

- Socratic can remain a learning workflow/activity unless it needs shared tools, trajectory, and handoff.
- Temporal/Staleness is a detector. Calling it "Temporal Agent" conflicts with Temporal the orchestration system and adds confusion.
- Connector and Curator both create suggestions; they may share one "Knowledge Maintenance" agent with different modes unless separate UX/value is needed.
- Synthesis and Synthesis Export are now separate concepts and should not both be casually called "Synthesis Agent" without disambiguation.
- Research worker agent may be redundant if chat retrieval now lives in the API-side `chat-llm` path.

## What Is Real Enough To Keep

These are defensible as product capabilities, though not all are uniform runtime agents:

- Compiler: core ingest-to-wiki pipeline.
- Deep Research: large workflow-backed research feature.
- Code: canvas code generation/execution path, behind flag.
- Visualization: graph view spec generation, strong tool-loop candidate.
- Socratic: learning/quiz feature.
- Synthesis: note synthesis suggestions.
- Narrator: audio generation from notes.
- Connector/Curator/Staleness: project maintenance/suggestion features.

## Recommended Reframe

Avoid claiming "12 production agents" unless the product intentionally treats agent as a role, not a runtime class.

Better wording:

> OpenCairn has a 12-role AI architecture. Some roles are live product workflows today, some are automated maintenance jobs, and some are still being unified under the shared agent runtime.

Or, for product UI:

> AI workflows: ingest compilation, grounded Q&A, deep research, learning, synthesis, narration, code, visualization, and maintenance suggestions.

This describes actual capabilities instead of forcing every item into a separate agent persona.

## Recommended Next Work

### A. Documentation honesty pass

Update docs and landing copy so "12 agents" is not represented as 12 fully active, uniform runtime agents.

Targets:

- `docs/agents/agent-behavior-spec.md`
- `docs/superpowers/specs/2026-04-09-opencairn-design.md`
- `docs/architecture/agent-platform-roadmap.md`
- `apps/web/messages/{ko,en}/landing.json`

### B. Agent inventory table in source docs

Create a maintained table with columns:

- role name
- worker class
- runtime.Agent subclass yes/no
- Temporal workflow
- API route
- UI route
- feature flag
- tool-loop yes/no
- product status

This table should replace ambiguous "12 agents complete" checklists.

### C. Runtime consolidation decision

Choose one of two directions:

1. Strict runtime model: every production agent must either subclass `runtime.Agent` or be explicitly categorized as a workflow, not an agent.
2. Product workflow model: stop treating runtime inheritance as the definition of agent; define agent as a user-facing AI workflow with observability and permissions.

Current repo mixes both. That is the root of the confusion.

### D. Tool architecture cleanup

Pick 2-3 high-value agents to migrate to `run_with_tools` first:

- Research, because grounded retrieval/tool use matters.
- Compiler, because ingest-to-wiki is core.
- Curator/Connector, because both are suggestion producers and can share tools.

Do not force all 12 through a loop just to satisfy the number. Some should remain deterministic workflows or activities.

### E. Product consolidation

For v0.1, a smaller honest product surface is likely stronger:

- Ask / Research
- Ingest / Compile
- Deep Research
- Learn / Socratic
- Visualize
- Code Canvas
- Synthesis / Export
- Maintenance Suggestions

This is fewer than 12 labels, but clearer and easier to test.
