# Google Workspace Export Live Smoke

This smoke is a maintainer-run check for the real Google Workspace export path:
generated OpenCairn files, the authenticated export API, Temporal worker upload
and conversion, Google Drive/Docs/Sheets/Slides, the internal callback, and
`agent_file_provider_exports` persistence. It is not a product UI test.

The helper lives at:

```powershell
apps/api/scripts/google-workspace-export-live-smoke.mjs
```

## Scope

The script finds an existing `google_drive` integration grant with `drive.file`,
signs a local Better Auth session for that user, creates a temporary project in
the granted workspace, generates four files through the document-generation API,
then exports each generated `agent_file` to Google:

- PDF -> Google Drive raw upload
- DOCX -> Google Docs conversion
- XLSX -> Google Sheets conversion
- PPTX -> Google Slides conversion

For each export, the script waits for the `file.export` action to complete,
checks the terminal action result, checks the provider export row, and prints a
JSON summary with external Google object IDs and URLs.

## Required Services

Run against local API, worker, Postgres, Redis, Temporal, MinIO, and real Google
OAuth credentials. The API and worker must both be started with:

```powershell
$env:FEATURE_DOCUMENT_GENERATION = "true"
$env:FEATURE_GOOGLE_WORKSPACE_EXPORT = "true"
```

The workspace used by the smoke must already have a Google Drive integration
grant with `drive.file`. To pin the exact grant instead of using the newest
matching row, set:

```powershell
$env:GOOGLE_EXPORT_SMOKE_USER_ID = "<user id>"
$env:GOOGLE_EXPORT_SMOKE_WORKSPACE_ID = "<workspace id>"
```

Use the same environment-loading cautions as
`docs/testing/document-generation-live-smoke.md`: avoid ad hoc `.env` parsers
that corrupt URLs or secrets, and set local callback URLs explicitly when API
and worker run as host processes.

## Running

After migrations and services are ready:

```powershell
pnpm --dir apps/api exec tsx scripts\google-workspace-export-live-smoke.mjs
```

Optional timeout override:

```powershell
$env:GOOGLE_EXPORT_SMOKE_TIMEOUT_MS = "240000"
```

## Output QA

The final JSON includes:

- selected Google grant user/workspace/account email
- temporary project and source note IDs
- generated agent file IDs and object-storage keys
- one export result per provider
- external Google object IDs, URLs, exported MIME types, and provider-export row
  IDs

Expected Google-native exported MIME types:

- DOCX -> `application/vnd.google-apps.document`
- XLSX -> `application/vnd.google-apps.spreadsheet`
- PPTX -> `application/vnd.google-apps.presentation`

The PDF raw upload remains a Drive file and does not require a Google-native
MIME type.
