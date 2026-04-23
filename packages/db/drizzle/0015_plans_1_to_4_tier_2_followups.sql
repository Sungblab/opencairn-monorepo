-- PR #13 (migration 0014) gemini review follow-ups.
--
-- Gemini flagged two issues on 0014 that we did not catch at author time:
--
--   (a) `workspace_invites_token_idx` was redundant — the `.unique()` on
--       `token` auto-creates `workspace_invites_token_unique`, and a second
--       btree on the same column is pure write amplification. Drop it here.
--
--   (b) 0014's `workspaces_slug_lower_check` CHECK was added without a
--       leading `UPDATE workspaces SET slug = lower(slug) ...`. Dev data
--       happened to be all-lowercase, so 0014 applied cleanly, but a prod
--       run against a DB with any uppercase slug would fail the CHECK
--       before the row could be normalised. Retro-adding the UPDATE to
--       0015 cannot rescue that path — 0014 runs first and aborts — so the
--       mitigation lives in the deploy runbook instead (see
--       docs/review/2026-04-23-plans-1-to-4-review.md § Tier 2). This
--       migration intentionally does NOT run an UPDATE; it is a no-op for
--       slug data.

DROP INDEX "workspace_invites_token_idx";
