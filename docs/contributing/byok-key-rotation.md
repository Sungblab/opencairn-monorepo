# BYOK Token Encryption Key Rotation

`INTEGRATION_TOKEN_ENCRYPTION_KEY` encrypts third-party OAuth tokens stored in
`user_integrations.access_token_encrypted` (Google Drive, Notion, future
providers). It also encrypts BYOK provider keys held in the same table.

Until 2026-04-29 the key was effectively non-rotatable: decrypt only knew the
current key, so swapping it silently turned every existing token into
`{ registered: false }` (audit `2026-04-28-completion-claims-audit.md` Tier 5
§5.2). This document covers the rotation procedure now that
`INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD` is supported as a decrypt-only fallback.

## When to rotate

- Suspected compromise of the host secret store, deployment artifacts, or any
  CI environment that ever received the key.
- Periodic compliance schedule (every N months for self-hosted SOC2 prep).
- Personnel change with operator-level secret access.

If you've never set `INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD` before, rotation is
safe — the new fallback path is opt-in and a missing `_OLD` is treated as
"single-key mode," identical to the pre-2026-04-29 behavior.

## Procedure (zero-downtime)

1. **Generate a new key.**

   ```bash
   openssl rand -base64 32
   ```

2. **Stage the rotation** in your secret manager / `.env` for both `apps/api`
   and `apps/worker` (they MUST stay in sync):

   ```bash
   # Old current key, now stepped down.
   INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD=<previous value of INTEGRATION_TOKEN_ENCRYPTION_KEY>
   # The new key generated in step 1.
   INTEGRATION_TOKEN_ENCRYPTION_KEY=<new key>
   ```

3. **Deploy.** Both services restart with the new pair. Behavior:
   - `encrypt_token` always writes with the new key.
   - `decrypt_token` tries the new key first; if that fails (existing rows
     written with the previous key), it falls back to `_OLD` and succeeds.
   - A blob that decrypts under neither raises — `users.ts` reports the same
     `{ registered: false }` it did before, but only for blobs that genuinely
     belong to neither key (corruption or pre-pre-rotation residue).

4. **Re-encrypt existing rows** so you can drop `_OLD`. Two options:

   - **Background sweep** (recommended for >100 users): a small one-shot
     script that selects every `user_integrations` row, calls
     `decryptToken` then `encryptToken`, and writes back. Run it once after
     deploying step 3.
   - **Natural expiry**: for rotation cadences longer than your OAuth refresh
     token lifetime (Google Drive: 6 months without refresh; Notion: never
     unless explicitly revoked), tokens you haven't touched will eventually
     get re-issued and re-encrypted with the current key on next OAuth round
     trip. Cheaper but slower; only safe if you don't need a hard cutover.

5. **Drop `_OLD`** once you're confident every row is on the new key:

   ```bash
   # Remove the line entirely or set it empty:
   INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD=
   ```

   Re-deploy. Subsequent decrypts of any straggler rows under the old key
   will now fail loudly, which is what you want at this stage.

## Failure modes & defenses

- **`_OLD` set to a malformed value (wrong length).** Both runtimes throw
  `INTEGRATION_TOKEN_ENCRYPTION_KEY_OLD must decode to 32 bytes (...)` rather
  than silently falling back to "no _OLD". This is intentional — a typo'd
  rotation is operator misconfig, not a runtime "wrong key" event.
- **`_OLD` set but blob decrypts under current key.** The fallback never
  runs. Cost is exactly one extra env read per decrypt that succeeds.
- **Both keys wrong.** `decryptToken` re-throws the *current* key's error
  (the canonical "wrong key" path), so existing error handling in
  `users.ts:165` still kicks in correctly.
- **API and worker out of sync.** If you forget to update one side's secret,
  the worker will fail to decrypt tokens written by the API or vice versa.
  Always update both before redeploying. The wire format is identical
  (`iv(12) || tag(16) || ct`) so a single shared secret rotation suffices.

## Rotation surface

This document covers only `INTEGRATION_TOKEN_ENCRYPTION_KEY`. Other secrets
have different rotation profiles:

- `INTERNAL_API_SECRET` — short-lived shared secret between worker and API.
  Restart worker and API together; no fallback envelope needed because the
  secret authenticates the *channel*, not stored ciphertext at rest.
- `BETTER_AUTH_SECRET` — invalidates active sessions on rotation. There's no
  "old" mode; users re-login. Plan rotations around a maintenance window.
- `GEMINI_API_KEY` (admin pool) — flat env replacement, no encrypted rows
  at rest.

If you find another at-rest encryption secret that needs rotation support,
extend the same `_OLD` decrypt-fallback pattern (`getCurrentKey()` plus
`getOldKey()`) and document here.
