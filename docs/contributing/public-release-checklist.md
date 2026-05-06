# Public Release Checklist

This checklist tracks the public surface that a new visitor sees before they
run OpenCairn. It is not a launch promise. Use it to keep the repository clear,
auditable, and honest while the product remains alpha.

## Repository Surface

| Surface | Current expectation | Evidence path |
| --- | --- | --- |
| Project summary | Explain OpenCairn as a self-hostable, multi-LLM knowledge OS without overstating agent autonomy. | `README.md`, `README.ko.md` |
| License | AGPL-3.0-or-later plus optional commercial license must be visible. | `LICENSE`, `COMMERCIAL-LICENSING.md`, `CLA.md` |
| Contribution path | Contributors should know how to set up, branch, test, and open PRs. | `CONTRIBUTING.md`, `docs/contributing/dev-guide.md` |
| Security contact | Vulnerability reports should go through private GitHub Security Advisories. | `SECURITY.md` |
| Roadmap | Public status should be summarized without internal handoff logs. | `docs/contributing/roadmap.md`, `docs/contributing/feature-registry.md` |
| Hosted-service boundary | Legal, blog, analytics, and hosted URLs must stay env/default driven or external. | `docs/contributing/hosted-service.md`, `.env.example` |
| Benchmark evidence | RAG, parser, and agent quality claims need metrics and fixtures. | `docs/testing/rag-agent-benchmark-plan.md` |

## Copy Rules

- Say **alpha** when describing current readiness.
- Separate implemented foundations from quality claims that still need
  benchmark evidence.
- Avoid implying every roadmap agent is default-on today.
- Mention self-hosting first; hosted billing and commercial operation are later
  operator surfaces.
- Treat permission-aware retrieval and auditable actions as product principles,
  not as generic "AI magic" claims.

## Screenshot And Demo Rules

Public screenshots or videos should show real product states:

- project explorer with notes or generated files
- grounded answer with visible citations
- Agent Panel action card with preview, approval, status, or error
- workflow console run list/detail
- import/export or document generation result when the local stack supports it

Avoid mockups that imply a production-ready hosted service, billing, or provider
integration that is not enabled in the OSS app by default.

## Benchmark Publication Gate

Before a README badge, landing-page metric, or blog post claims quality, collect:

1. command used
2. commit SHA
3. fixture manifest version
4. provider/model configuration
5. metric table
6. at least three representative failures or caveats

Passing unit tests is not enough for public RAG or agent quality claims. The
benchmark must cover the claim directly.

## Pre-PR Review Questions

- Does the public copy match the current `feature-registry.md` status?
- Does the copy distinguish implemented architecture from measured quality?
- Are legal/security/contributing links still reachable from the README?
- Did a generated sitemap or hosted site page change need to be committed in
  the website repository instead of the OSS app?
- If the change mentions benchmarks, does it link to the benchmark plan or an
  actual result report?
