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
| Architecture decisions | `architecture/adr/` |

## Agents And Runtime

| Need | Read |
| --- | --- |
| Agent behavior guardrails | `agents/agent-behavior-spec.md` |
| Temporal workflows | `agents/temporal-workflows.md` |
| Context management and RAG | `agents/context-management.md` |

## Operations

| Need | Read |
| --- | --- |
| Public incident response template | `runbooks/incident-response.md` |
| Browser sandbox E2E notes | `testing/sandbox-testing.md` |

Raw implementation plans and review findings are maintained privately by the
operator. Public status belongs in `contributing/roadmap.md` and
`contributing/feature-registry.md`.
