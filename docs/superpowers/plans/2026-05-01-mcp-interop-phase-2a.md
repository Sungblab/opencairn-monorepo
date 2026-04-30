# MCP Interop Phase 2-A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase 1 read-only OpenCairn MCP server easier to connect from Claude Code, Codex, and ChatGPT/OpenAI data-only MCP clients before building full OAuth.

**Architecture:** Keep the existing `/api/mcp` Streamable HTTP server and workspace bearer token model. Add the smallest protocol-compatible alias layer (`search`, `fetch`) on top of existing `searchMcpNotes` and `getMcpNote`, then document client setup paths and the OAuth gaps separately.

**Tech Stack:** Hono 4, `@modelcontextprotocol/sdk`, Drizzle/Postgres, OpenCairn MCP server token auth, Vitest, Markdown docs.

---

## Research Summary

- Claude Code supports remote HTTP MCP servers, static `Authorization` headers, project `.mcp.json`, OAuth, fixed callback ports, metadata override, and dynamic headers. Static bearer headers are enough for Phase 2-A; OAuth login belongs in Phase 2-B. [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)
- Claude remote custom connectors expect a public remote MCP URL and generally use OAuth. Claude documents Dynamic Client Registration support and callback URL behavior for hosted connectors, so OpenCairn bearer-only custom connector support should be described as Claude Code-first until OAuth ships. [Claude custom connector guide](https://support.claude.com/en/articles/11503834-build-custom-connectors-via-remote-mcp-servers)
- Codex reads MCP servers from `~/.codex/config.toml`; the current config reference supports URL-based servers, static HTTP headers, OAuth resource/scopes, and login-oriented options. Phase 2-A should document bearer-token env wiring and mark `codex mcp login` as Phase 2-B. [Codex config reference](https://developers.openai.com/codex/config-reference)
- ChatGPT/OpenAI data-only MCP compatibility for company knowledge and deep research expects exactly two read-only tools named `search` and `fetch`. Their results should be a single `type: "text"` content item containing JSON for `{ results: [...] }` and a fetched document object. [OpenAI MCP guide](https://developers.openai.com/api/docs/mcp)
- Apps SDK uses MCP as the underlying protocol, recommends Streamable HTTP, and calls out protected resource metadata, OAuth 2.1, and dynamic client registration as the standard auth path. [Apps SDK MCP concept](https://developers.openai.com/apps-sdk/concepts/mcp-server)
- MCP draft authorization now requires Protected Resource Metadata for authorization server discovery, while DCR support is optional in the draft but strongly recommended in the 2025-03-26 spec. [MCP draft authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization), [MCP 2025-03-26 authorization](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- RFC 9728 defines protected resource metadata and the `WWW-Authenticate` discovery flow that OpenCairn Phase 1 already partially exposes. [RFC 9728](https://www.ietf.org/rfc/rfc9728.pdf)

## Scope Decision

Phase 2-A implements the read-only data compatibility slice only:

- Add `search(query)` and `fetch(id)` aliases.
- Preserve `search_notes`, `get_note`, and `list_projects`.
- Return OpenAI-compatible JSON text content while also preserving structured content for clients that use it.
- Document Claude Code, Claude project config, Claude plugin packaging candidates, Codex config, ChatGPT/OpenAI compatibility, hosted HTTPS readiness, and OAuth Phase 2-B gaps.

Out of scope:

- OAuth 2.1 authorization server, authorization-code + PKCE, DCR, and token refresh.
- Write/action tools.
- Stdio proxy package or local CLI distribution.
- Retrieval quality upgrades such as chunking, reranking, graph expansion, or verifier loops.
- `docs/contributing/plans-status.md` update before the implementation PR is merged.

## File Structure

- Modify `packages/shared/src/mcp-server.ts`: add alias input/result schemas and exported types.
- Modify `apps/api/src/lib/mcp-server/server.ts`: register `search` and `fetch` aliases and factor OpenAI-compatible formatting helpers.
- Modify `apps/api/tests/mcp-server/tools.test.ts`: cover formatting preservation and JSON text payload shape through pure helpers.
- Create `apps/api/tests/mcp-server/server.test.ts`: verify server tool registration includes both legacy and alias tools.
- Modify `docs/architecture/mcp-server.md`: add client setup guide, hosted readiness, OAuth gaps, and risk catalog.
- Modify `docs/architecture/api-contract.md`: document alias tools under MCP Server Read-Only.
- Create this plan document.

## Tasks

### Task 1: Shared Alias Schemas

- [x] Add `McpOpenAiSearchInputSchema` with `{ query: string }`.
- [x] Add `McpOpenAiFetchInputSchema` with `{ id: string }`.
- [x] Add OpenAI-compatible result schemas for search results and fetched documents.
- [x] Keep legacy schemas unchanged.

### Task 2: API Alias Registration

- [x] Register `search` with a read-only annotation and a description that says it is the OpenAI/ChatGPT-compatible alias for `search_notes`.
- [x] Register `fetch` with a read-only annotation and a description that says it is the OpenAI/ChatGPT-compatible alias for `get_note`.
- [x] Reuse `searchMcpNotes` and `getMcpNote`; do not add new retrieval logic.
- [x] Return a single JSON text content item for alias calls and keep `structuredContent`.

### Task 3: Focused Tests

- [x] Verify server registration exposes `search`, `fetch`, `search_notes`, `get_note`, and `list_projects`.
- [x] Verify `fetch` formatting preserves line breaks, lists, and fenced code through the existing `contentText`.
- [x] Verify OpenAI-compatible search/fetch helpers return JSON text content that parses to the documented shape.

### Task 4: Documentation

- [x] Update `docs/architecture/mcp-server.md` with Claude Code, `.mcp.json`, plugin packaging candidate, Codex config, ChatGPT/OpenAI data-only guide, hosted endpoint readiness, OAuth Phase 2-B gaps, stdio Phase 2-C note, and read-only risk catalog.
- [x] Update `docs/architecture/api-contract.md` with `search`/`fetch` alias tool contracts.
- [x] Keep official links in docs and this plan.
- [x] Do not update `docs/contributing/plans-status.md`.

### Task 5: Verification

- [x] Attempt `pnpm --filter @opencairn/api test -- mcp-server/tools.test.ts mcp-server/server.test.ts`; Windows Vitest stopped before loading tests with the known `ERR_PACKAGE_IMPORT_NOT_DEFINED: #module-evaluator` startup error from the Phase 1 baseline.
- [x] Run `pnpm --filter @opencairn/api exec tsx` smoke checks for server tool registration and JSON text formatting.
- [x] Run `pnpm --filter @opencairn/api build`.
- [x] Run `git diff --check`.
- [ ] Commit, push, and open a draft PR.

## Follow-Ups

- Phase 2-B: OAuth 2.1 authorization server, protected resource metadata with non-empty `authorization_servers`, authorization server metadata, PKCE, refresh tokens, and either DCR or documented preconfigured client credentials.
- Phase 2-C: stdio/local proxy package for clients or environments that cannot attach HTTP auth headers.
- Phase 3: write/action tools with explicit risk classification and per-tool authorization.
- Grounded Agent Retrieval: chunking/rerank/graph/verifier quality improvements, kept separate from this interop slice.
