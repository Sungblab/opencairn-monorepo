# Documentation Governance

This page keeps OpenCairn documentation navigable as the repository grows.
Prefer improving an existing routed document over adding another standalone
file.

## Document Tiers

| Tier | Location | Purpose | Keep here |
| --- | --- | --- | --- |
| Public router | `docs/README.md` | Short index for contributors and agents | Links to stable public docs only |
| Public status | `docs/contributing/roadmap.md`, `docs/contributing/feature-registry.md` | Stable feature status and ownership | Public product claims, owning paths, duplicate guards |
| Public architecture | `docs/architecture/`, `docs/agents/`, `docs/testing/` | Durable contracts and maps | API/data/security/testing decisions and visual maps |
| Public operations | `docs/runbooks/`, focused `docs/testing/*smoke.md` | Repeatable operator procedures | Incident and smoke-test runbooks |
| Private maintainer context | `.private-docs/` | Local status, review notes, handoffs | Raw audit findings, branch history, next-session prompts |
| Private execution plans | `docs/superpowers/` | Ignored specs and implementation plans | Current design/plan artifacts for agent sessions |

## Add Or Update

Before adding a new public document:

1. Search `docs/README.md` and `docs/contributing/feature-registry.md`.
2. If the content is a stable contract, add it under the relevant public area
   and link it from the nearest router.
3. If the content is implementation status, review feedback, or session handoff,
   keep it in `.private-docs/` or `docs/superpowers/`.
4. If the content is a visual overview, put it under `docs/architecture/maps/`
   and keep the detailed source of truth elsewhere.
5. Run `pnpm docs:check` and `pnpm check:health`.

## Split Or Consolidate

Split a document only when readers need a different entry point or ownership
boundary. Consolidate when a document is just another narrative version of a
status already tracked by the roadmap, feature registry, or private plan status.

Good split reasons:

- separate public contributor contract from private execution history
- separate a long runbook from architecture explanation
- separate a visual map from a detailed contract

Bad split reasons:

- preserving raw agent output
- creating a new file because the right router was hard to find
- duplicating the same feature status in public and private docs

## Review Checklist

- Is the document linked from `docs/README.md` or a nearby router?
- Does the file clearly say whether it is public contract, map, runbook, or
  private operator context?
- Would a future agent know whether to edit this file or a more canonical one?
- Does `pnpm docs:check` still pass?
