# RAG DB Retrieval Benchmark

Manifest version: 2026-05-08.db-backed-retrieval.v1

Runner input HEAD: `1e5cd912cd471d1626080e3ceb8bb95c43eee7e3`

This SHA is captured before the runner rewrites the report artifact. The final
PR or merge commit can differ from this value.

Command:

```powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@127.0.0.1:15432/DB_NAME"
pnpm --filter @opencairn/api benchmark:rag-db
```

Raw JSONL: `apps/api/benchmarks/results/rag-db-retrieval-2026-05-08-db-backed-retrieval-v1.jsonl`

## Summary

| Metric | Value |
| --- | ---: |
| DB cases | 1 |
| DB enabled | true |
| Permission leakage count | 0 |
| Failure count | 0 |

## Scope

This benchmark seeds real users, workspace membership, project permission, page-level permission overrides, notes, and note chunks. It runs the production `retrieveWithPolicy()` path with a deterministic query embedding override so local DB evaluation does not require a live embedding provider.

The first fixture proves that a guest who can read the project still does not receive a note hidden by `inheritParent=false` and page-level permissions, even when that hidden chunk is more vector-similar than the readable chunk.
