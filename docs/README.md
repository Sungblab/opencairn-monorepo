# OpenCairn Docs

This directory contains the public documentation for OpenCairn. Internal
execution logs, raw audit notes, private agent handoffs, and local operator
workflow files are intentionally excluded from the public repository.

## Start Here

| Need | Read |
| --- | --- |
| Current public roadmap and feature status | `contributing/roadmap.md` |
| Existing feature ownership and duplicate-work guard | `contributing/feature-registry.md` |
| Local development and self-hosting setup | `contributing/dev-guide.md` |
| Hosted service and OSS boundary | `contributing/hosted-service.md` |
| Test strategy | `testing/strategy.md` |
| RAG, parser, and agent benchmark plan | `testing/rag-agent-benchmark-plan.md` |
| Public release checklist | `contributing/public-release-checklist.md` |

## Architecture

| Need | Read |
| --- | --- |
| API contract | `architecture/api-contract.md` |
| Data flow from ingest to wiki and Q&A | `architecture/data-flow.md` |
| Collaboration model | `architecture/collaboration-model.md` |
| Security model | `architecture/security-model.md` |
| Context budget policy | `architecture/context-budget.md` |
| Backup and data portability | `architecture/backup-strategy.md` |
| Billing model | `architecture/billing-model.md` |
| Agentic workflows across notes, files, code, import, and export | `architecture/agentic-workflow-roadmap.md` |
| Document generation and file IDE flow | `architecture/document-generation-ide-flow.md` |
| Workspace ontology classes, predicates, triples, and validation | `architecture/ontology-atlas.md` |
| Architecture decisions | `architecture/adr/` |

## Agents And Runtime

| Need | Read |
| --- | --- |
| Agent behavior guardrails | `agents/agent-behavior-spec.md` |
| Temporal workflows | `agents/temporal-workflows.md` |
| Context management and RAG | `agents/context-management.md` |
| Gemini provider surface | `agents/gemini-docs-audit.md` |
| LLM provider parity | `agents/llm-provider-surface-parity.md` |

## Operations

| Need | Read |
| --- | --- |
| Public incident response template | `runbooks/incident-response.md` |
| Browser sandbox E2E notes | `testing/sandbox-testing.md` |
| Live product flow smoke | `testing/live-product-flow-smoke.md` |
| Note analysis drain Temporal Schedule smoke | `testing/note-analysis-drain-schedule-live-smoke.md` |
| RAG, parser, and agent benchmark plan | `testing/rag-agent-benchmark-plan.md` |

Raw implementation plans and review findings are maintained privately by the
operator. Public status belongs in `contributing/roadmap.md` and
`contributing/feature-registry.md`.
