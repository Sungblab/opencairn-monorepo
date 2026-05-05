# Document Generation Live Smoke

This smoke is a maintainer-run check for the real document-generation path:
API, Temporal worker, object storage, callback registration, and authenticated
download. It is not a product UI test.

## Scope

The smoke helper lives at
`apps/api/scripts/document-generation-live-smoke.mjs`. It seeds one workspace,
creates source fixtures for `note`, `agent_file`, `chat_thread`,
`research_run`, and `synthesis_run`, submits one generation request for each
source type, waits for the action ledger to complete, checks object storage,
checks the `agent_files` row, downloads the file through the authenticated API,
and prints a JSON summary.

Expected generated formats:

- `note` -> PDF
- `agent_file` -> DOCX
- `chat_thread` -> PPTX
- `research_run` -> XLSX
- `synthesis_run` with `documentId` -> PDF

## Required Services

Run against local API, worker, Postgres, Redis, Temporal, and MinIO. In
worktrees, prefer worktree-specific ports instead of editing the root `.env`.
The previously verified port pattern was:

- API: `127.0.0.1:4000`
- Postgres: `127.0.0.1:25432`
- Redis: `127.0.0.1:26379`
- Temporal: `127.0.0.1:27233`
- MinIO S3: `127.0.0.1:29000`
- MinIO console: `127.0.0.1:29001`

The worker must be started with an explicit local API callback URL:

```powershell
$env:INTERNAL_API_URL = "http://localhost:4000"
```

Do not rely on a Docker-default `http://api:4000` value when the worker process
is running on the host. A malformed `INTERNAL_API_URL` can make the generation
complete in Temporal but fail the internal callback.

## PowerShell Env Loading

Avoid one-off parsers that split every `.env` line on `=` or trim arbitrary
characters. Those parsers can corrupt quoted URLs, inline comments, and secrets.
Use a parser that only treats the first `=` as the boundary and strips matching
outer quotes:

```powershell
$envFile = "C:\Users\Sungbin\Documents\GitHub\opencairn-monorepo\.env"
Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
    $name = $matches[1].Trim()
    $value = $matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

$env:API_BASE_URL = "http://127.0.0.1:4000"
$env:INTERNAL_API_URL = "http://localhost:4000"
$env:DATABASE_URL = $env:DATABASE_URL `
  -replace 'localhost:5432', 'localhost:25432' `
  -replace '127\.0\.0\.1:5432', '127.0.0.1:25432'
$env:REDIS_URL = "redis://127.0.0.1:26379"
$env:TEMPORAL_ADDRESS = "127.0.0.1:27233"
$env:S3_ENDPOINT = "127.0.0.1:29000"
$env:FEATURE_DOCUMENT_GENERATION = "true"
```

The script now fails fast if `API_BASE_URL` or `INTERNAL_API_URL` looks like a
corrupted URL, including truncated schemes such as `ttp://...`.

## Running

After migrations and services are ready:

```powershell
pnpm --dir apps/api exec tsx scripts\document-generation-live-smoke.mjs
```

Optional timeout override:

```powershell
$env:DOC_GEN_SMOKE_TIMEOUT_MS = "180000"
```

## Output QA

The final JSON includes:

- preflight environment summary
- seeded workspace/project/source IDs
- source picker coverage
- one result per source and format
- object storage byte count
- authenticated download status
- artifact QA summary with downloaded bytes, content type, SHA-256, and file
  magic bytes

For PDF outputs the magic bytes should start with `%PDF` (`25504446`). For
DOCX, PPTX, and XLSX outputs the magic bytes should be a ZIP signature such as
`504b0304`.
