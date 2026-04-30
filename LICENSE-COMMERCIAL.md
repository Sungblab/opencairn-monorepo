# OpenCairn Commercial License

OpenCairn is dual-licensed.

- **Default**: [AGPL-3.0-or-later](LICENSE). Self-host, fork, modify, redistribute, or
  run as a network service for others — all permitted under AGPL terms, including the
  network-use clause that requires modified source to be available to network users.

- **Alternative**: a **commercial license** is available for organizations that cannot
  comply with AGPLv3's network-use clause or whose internal open-source policy
  prohibits AGPL components.

## When you may need a commercial license

The AGPLv3 license is sufficient for the vast majority of use cases — including
running an internal-only deployment that does not redistribute the software outside
your organization. You typically only need a commercial license if **all** of the
following apply:

1. You operate OpenCairn (modified or unmodified) as a service that other
   organizations or external users access over a network, **and**
2. You cannot make the modified source code available to those users under AGPL
   terms (e.g. because of internal IP policy, customer NDAs, or competitive
   constraints), **and**
3. Your organization's open-source policy explicitly disallows AGPL-licensed
   dependencies in production systems.

If only criterion (1) applies but you are willing to publish your modifications
under AGPL, you do **not** need a commercial license.

## What a commercial license provides

- Use, modification, and redistribution of OpenCairn in proprietary derivative
  works without triggering AGPL's source-disclosure requirements.
- Standard commercial warranties, indemnification, and support terms (negotiated
  per-deal).
- Optional bundled support, SLA, and migration assistance.

## How to inquire

Open a GitHub Discussion in this repository under the **commercial-licensing**
category, or contact the maintainer directly:

- Maintainer: Sungblab
- Email (interim): `sungblab@gmail.com`
- Future contact (planned): `licensing@opencairn.com` (after domain registration)

Please include in your inquiry:

- Organization name and brief description.
- Intended deployment topology (internal-only, customer-facing service, embedded
  product, etc.).
- Approximate user/seat count.
- The specific AGPL clause(s) that conflict with your usage so we can scope the
  commercial license appropriately.

## Notes for contributors

OpenCairn accepts a Contributor License Agreement (see [`CLA.md`](CLA.md)) from
all non-trivial contributors. The CLA grants the maintainer the right to
sublicense your contribution under both AGPL-3.0 and the commercial license
offered above. You retain copyright in your contribution. Trivial contributions
(typo fixes, minor doc edits, small dependency bumps) do not require a signed
CLA, but the maintainer may request one for any contribution at their discretion.

## Disclaimer

This document is a description of the commercial-licensing program, not a
license itself. The terms of any commercial license are set in a separate
written agreement signed by both parties. Nothing in this document creates an
obligation on either side until such an agreement is signed.

This document is provided as a baseline template. Organizations relying on this
program for material commercial decisions should obtain independent legal
review.
