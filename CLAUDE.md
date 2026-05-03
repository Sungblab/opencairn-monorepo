# OpenCairn Claude Guide

Read `AGENTS.md` first and follow it as the operative project guide. This file is intentionally thin so Claude-specific guidance does not drift from the Codex/agent guidance.

Claude Code skills live in `~/.claude/skills/`. The repo-local `.claude/` directory is runtime lock/state data and should not be treated as project instructions.

Use the same routing discipline as `AGENTS.md`:

1. `docs/README.md`
2. `docs/contributing/plans-status.md`
3. `docs/contributing/feature-registry.md`
4. `docs/contributing/project-history.md`
5. Relevant plan/spec files
6. Linked audits when implementation claims matter

Known caveat: old completion markers were sometimes ahead of reality. Check `docs/review/2026-04-28-completion-claims-audit.md` before relying on historical "complete" labels.
