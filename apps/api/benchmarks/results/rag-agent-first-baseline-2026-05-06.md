# RAG And Agent First Baseline

Date: 2026-05-06

Runner input HEAD: `c09f8b87766b0053716e3a549cfe8504732bfaf0`

This SHA is captured before the runner rewrites the report artifact. The final
PR or merge commit can differ from this value.

Command:

```powershell
pnpm --filter @opencairn/api benchmark:rag-agent
```

Raw JSONL: `apps/api/benchmarks/results/rag-agent-first-baseline-2026-05-06.jsonl`

## Summary

| Area | Cases | Key result |
| --- | ---: | --- |
| Permission-aware RAG | 3 | `permission_leakage_count = 0` |
| Citation grounding skeleton | 6 | Manual fixture manifest only; LLM judge disabled |
| Agentic workflow actual slice | 1 | `note.update` is the first actual verification target |
| Agentic workflow follow-up skeleton | 1 | Excluded from actual metric averages |

## Metrics

| Metric | Value |
| --- | ---: |
| `permission_leakage_count` | 0 |
| `agentic_actual_fixture_count` | 1 |
| `agentic_follow_up_fixture_count` | 1 |
| `plan_validity_rate` | 1.00 |
| `approval_boundary_pass_rate` | 1.00 |
| `action_audit_completeness` | 1.00 |

## Failure Examples And Limits

- No permission leakage failures were observed in the deterministic post-filter traces.
- Example permission failure this fixture is designed to catch: `note-alice-private-budget` appearing in Bob's retrieval candidates or citations would increment `permission_leakage_count`.
- Example grounding failure reserved for the citation skeleton: "Unreadable notes may be cited if their title is visible" is an unsupported claim for `rag-permission-filter-before-citations`.
- Example agentic workflow failure reserved for follow-up: `code_project.run` without approval or captured stdout/stderr would fail the approval and audit checks once executable fixtures are added.
- Citation grounding is only a labeled manifest. It documents expected evidence, allowed citations, and unsupported claim examples, but does not score generated model output yet.
- Agentic workflow scoring covers manifest shape and action audit structure. Only `note.update` is marked as the actual first-slice target; `code_project.run` is a follow-up skeleton.
- This run does not use DB seeding, provider calls, production ingest, parser dependency changes, or migrations.

## Follow-up

- Add DB-backed permission fixture seeding around the real retrieval path.
- Add manual answer outputs and a deterministic citation grounding scorer before attaching an LLM judge.
- Add executable `code_project.run` success/failure fixtures and recovery scoring.
- Add mutable-note freshness fixtures that exercise Yjs-backed reindexing.
