# OpenCairn MCP Server

OpenCairn MCP Server Phase 1 exposes workspace knowledge to external agent
clients through a read-only Streamable HTTP MCP endpoint.

## Endpoint

- Hosted or self-hosted API: `{PUBLIC_API_URL}/api/mcp`
- Local dev default: `http://localhost:4000/api/mcp`
- OAuth Protected Resource Metadata:
  - `/.well-known/oauth-protected-resource`
  - `/.well-known/oauth-protected-resource/api/mcp`

Do not hardcode a hosted domain in clients or docs. Deployments should derive
the endpoint from `PUBLIC_API_URL` or the request host.

## Feature Flag

Set `FEATURE_MCP_SERVER=true` to enable:

- `/api/mcp`
- `/api/mcp/tokens`
- settings UI token management

When disabled, protected API routes return 404.

## Authentication

Workspace owners and admins create read-only MCP access tokens from settings.
Tokens are prefixed with `ocmcp_`; plaintext is returned only once at creation.
The database stores a SHA-256 token hash and a short redacted prefix.

External clients call:

```http
Authorization: Bearer ocmcp_...
```

The resource server returns `WWW-Authenticate` with `resource_metadata` on
missing or invalid bearer credentials. Full OAuth authorization-code + PKCE is
a follow-up; Phase 1 implements the resource-server side and metadata surface.

## Tools

`search_notes`

- Input: `{ query: string, limit?: number, projectId?: string }`
- Scope: token workspace; `projectId` must belong to that workspace.
- Output: note hits with snippet, source metadata, vector score, BM25 score,
  and fused RRF score.

`get_note`

- Input: `{ noteId: string }`
- Scope: token workspace.
- Output: one clipped note text payload.
- Unknown, soft-deleted, and cross-workspace notes all return a generic MCP
  tool error to avoid existence leaks.

`list_projects`

- Input: `{ limit?: number }`
- Scope: token workspace.
- Output: project id, name, description, and updated timestamp.

## Boundaries

Phase 1 does not expose write tools, import/sync actions, external-send
actions, or provider-specific Drive/GitHub/Notion import UX. Existing MCP
client registration at `/api/mcp/servers` remains separate.
