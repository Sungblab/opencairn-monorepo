# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Use **GitHub Security Advisories** on this repository:

> Security tab → *Report a vulnerability* → *Open a draft security advisory*

That opens a private channel where we can triage, confirm, and coordinate a fix and disclosure timeline. We aim to acknowledge receipt within 5 business days.

If GitHub Security Advisories is unavailable to you, please open a minimal public issue requesting a private contact channel — without disclosing the details — and we will reach out.

## Scope

In scope:

- The code in this repository.
- The default `docker compose` deployment topology shipped here.
- Default configurations of the api, worker, web, and hocuspocus services.
- The integration-token encryption layer and BYOK paths.

Out of scope:

- Vulnerabilities in third-party dependencies that already have a known upstream fix or in-progress upstream advisory — please report upstream as well.
- Issues that require physical access, an already-compromised host, or an already-compromised maintainer account to exploit.
- Best-practice / hardening suggestions that are not an exploitable issue — those are welcome as ordinary issues or PRs.
- Vulnerabilities in third-party AI providers (Google Gemini, Ollama, etc.). Report those to the upstream vendor.

## Supported versions

OpenCairn is in alpha. Only the `main` branch is supported. Security fixes land on `main` and are not back-ported to older commits or release tags.

## Disclosure

We credit reporters in the public advisory and release notes once a fix ships, unless you ask to remain anonymous. We will agree on a disclosure timeline with you when we acknowledge the report; for high-severity issues we aim for a coordinated public disclosure within 90 days of the initial report.

## Out-of-band contact

Operational security details for self-hosted deployments — key rotation, secret management, ingress hardening — are tracked in `docs/contributing/byok-key-rotation.md`, `docs/contributing/ops.md`, and `docs/runbooks/incident-response.md`. Those are not vulnerability channels; please still use Security Advisories for anything exploit-class.
