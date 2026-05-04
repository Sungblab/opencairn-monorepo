# Incident Response

This is the public incident-response template for self-hosters and contributors.
Hosted-service private channels, credentials, and operator-only escalation paths
are not stored in the public repository.

## Severity

| Level | Meaning |
| --- | --- |
| SEV1 | Data exposure, authentication bypass, or full service outage |
| SEV2 | Major feature outage, degraded collaboration, or failed ingest pipeline |
| SEV3 | Localized bug with workaround |

## First Response

1. Confirm scope: affected service, tenant/workspace, start time, and user impact.
2. Preserve logs and deployment metadata before restarting services.
3. If security-sensitive, rotate exposed credentials and disable affected tokens.
4. Mitigate first, then investigate root cause.
5. Record a public-safe summary after the incident is resolved.

## Useful Checks

```bash
docker compose ps
docker compose logs api --tail=200
docker compose logs web --tail=200
docker compose logs worker --tail=200
docker compose logs hocuspocus --tail=200
```

For hosted deployments, use the relevant cloud provider logs and secret manager.
Do not paste secrets, raw customer data, session cookies, OAuth tokens, or full
private prompts into public issues.

## Disclosure

Security reports should follow `SECURITY.md`. Public postmortems should describe
impact, timeline, root cause, and remediation without exposing exploit details
that would endanger unpatched deployments.
