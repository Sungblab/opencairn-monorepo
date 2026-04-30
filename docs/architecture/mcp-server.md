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

Hosted readiness:

- External clients need a public HTTPS endpoint. Localhost is only for local
  dev and self-host smoke tests.
- Set `PUBLIC_API_URL` or `OPENCAIRN_PUBLIC_API_URL` to the public API origin
  so OAuth Protected Resource Metadata advertises the same `/api/mcp` resource
  URL clients will call.
- `/.well-known/oauth-protected-resource/api/mcp` exists today, but
  `authorization_servers` is intentionally empty until OAuth Phase 2-B.

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

`search`

- Input: `{ query: string }`
- Scope: token workspace.
- Purpose: OpenAI/ChatGPT data-only compatibility alias.
- Output: `{ results: [{ id, title, url, text, metadata }] }` as JSON text
  content. `id` is the OpenCairn note id and can be passed to `fetch`.

`fetch`

- Input: `{ id: string }`
- Scope: token workspace.
- Purpose: OpenAI/ChatGPT data-only compatibility alias.
- Output: `{ id, title, url, text, metadata }` as JSON text content. `text`
  preserves the existing note formatting, including newlines, lists, and code
  fences.

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

Phase 2-A keeps the same boundary: read-only, workspace-scoped, and bearer
token based. Retrieval quality upgrades such as note chunking, reranking,
graph expansion, and verifier loops belong to the Grounded Agent Retrieval
track, not this interop slice.

## Claude Code

Bearer token connection:

```bash
claude mcp add --transport http opencairn https://<host>/api/mcp --header "Authorization: Bearer <token>"
```

Project `.mcp.json` example:

```json
{
  "mcpServers": {
    "opencairn": {
      "type": "http",
      "url": "https://<host>/api/mcp",
      "headers": {
        "Authorization": "Bearer ${OPENCAIRN_MCP_TOKEN}"
      }
    }
  }
}
```

Claude plugin packaging candidate:

```text
.claude-plugin/
  plugin.json
.mcp.json
```

Do not add a distributable plugin package to this repo until OAuth Phase 2-B
and hosted endpoint policy are settled. For now, document the candidate shape
and keep the runnable path as Claude Code + bearer token.

Official references:

- https://code.claude.com/docs/en/mcp
- https://support.claude.com/en/articles/11503834-build-custom-connectors-via-remote-mcp-servers

## Codex

User config example (`~/.codex/config.toml`) or project config
(`.codex/config.toml`):

```toml
[mcp_servers.opencairn]
url = "https://<host>/api/mcp"
bearer_token_env_var = "OPENCAIRN_MCP_TOKEN"
```

Set the token outside the config file:

```bash
export OPENCAIRN_MCP_TOKEN="ocmcp_..."
```

`codex mcp login opencairn` is reserved for OAuth Phase 2-B. Until OpenCairn
ships an authorization server and client registration story, use bearer token
env wiring.

Official reference:

- https://developers.openai.com/codex/config-reference

## ChatGPT And OpenAI Apps

Phase 2-A exposes the OpenAI data-only pair:

- `search(query: string)`
- `fetch(id: string)`

These are aliases only. They do not change retrieval behavior or permissions:
`search` calls the same server-side path as `search_notes`, and `fetch` calls
the same server-side path as `get_note`.

The response is a single MCP text content item containing JSON. OpenCairn also
sets `structuredContent` for clients that use it, but callers should not rely
on that for data-only compatibility.

Official references:

- https://developers.openai.com/api/docs/mcp
- https://developers.openai.com/apps-sdk/concepts/mcp-server

## OAuth Phase 2-B Gap

Current state:

- `WWW-Authenticate` includes a `resource_metadata` pointer.
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/api/mcp`
- Bearer token validation for workspace read tokens.

Missing for OAuth client login:

- Authorization server metadata.
- Authorization-code + PKCE endpoints.
- User consent and workspace selection.
- Refresh token policy.
- Dynamic Client Registration or a documented preconfigured-client fallback.
- Non-empty `authorization_servers` in Protected Resource Metadata.

Official references:

- https://modelcontextprotocol.io/specification/draft/basic/authorization
- https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization
- https://www.ietf.org/rfc/rfc9728.pdf

## Stdio Phase 2-C Note

Some local clients and locked-down environments may prefer a stdio package that
proxies local MCP stdio to hosted `/api/mcp`. That package is not in Phase 2-A.
When it is designed, it should avoid storing token plaintext and should read
`OPENCAIRN_MCP_TOKEN` or use OAuth after Phase 2-B.

## Risk Catalog

Read-only does not mean risk-free:

- Workspace owners/admins issue tokens that can read all token-scoped workspace
  notes exposed by the MCP server.
- Tokens are bearer credentials. Anyone with the token can call `/api/mcp`
  until expiration or revocation.
- Search snippets and fetched note text can contain private workspace content.
- External clients may retain or transmit retrieved content under their own
  policies.
- OpenCairn currently does not expose write tools, import tools, external-send
  actions, or provider-specific connector actions through this server.
