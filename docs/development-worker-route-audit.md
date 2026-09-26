# Development Worker pre-bootstrap route audit (phase 0)

The bootstrap deploy creates `8978-ai-control-plane-dev` for the first time. A Workers route that
already names that script would make the Worker reachable the moment it exists, before Worker-level
Access is installed. Workers routes are **zone-scoped**: they can only be listed with
`GET /zones/{zone_id}/workers/routes`, and the Admin v7 runtime token deliberately holds no zone
permission. This audit therefore runs with a **separate temporary read-only credential**.

## Credential

| Property | Value |
| --- | --- |
| Environment variable | `CLOUDFLARE_ROUTE_AUDIT_TOKEN` |
| Permissions | `Zone Read`, `Workers Routes Read` — all zones in account `de5e0273347b0b4c5f8f4e554aa2288f` |
| Never | `Workers Routes Write` / `Workers Routes Edit` |

This credential is not the Admin v7 runtime token, is never given to the connector, and no zone
permission is added to the runtime or connector token. Revoke it after the audit.

## Command

```sh
node scripts/audit-development-worker-routes.js
```

GET-only. The single request helper hard-codes `method: "GET"` and refuses a body, so no write verb
is reachable. The script prints a sanitized summary and **writes no record**; the owner authors the
record from that output against `schemas/development-worker-route-audit-record.schema.json`.

## Endpoints

1. `GET /zones?per_page=50&page=N` — every zone visible to the credential, with no search filter,
   collected by the same strict pagination rule as the connector. Cloudflare documents
   `total_count` as the total without search parameters, so only the unfiltered population can
   prove completeness. Every visible zone must report `account.id` equal to the authorized account.
2. `GET /zones/{zone_id}/workers/routes` — for every enumerated zone

The credential must be scoped to exactly the authorized account. A zone from any other account stops
the audit, and so does an empty zone listing: zero visible zones cannot be distinguished from a
credential scoped to the wrong account, so it never passes as a completed audit. An authorized
account with genuinely no zones therefore stops here and requires owner review.

## Required outcome

Zero routes whose `script` equals `8978-ai-control-plane-dev`.

## Stop conditions

- any zone cannot be enumerated
- pagination metadata is missing, malformed, or contradictory: an unexpected page index, a
  `total_pages` that disagrees with `total_count` and `per_page`, a truncated non-final page, a
  repeated zone ID, totals that change between pages, or a collected count below `total_count`
- any zone does not report its account
- any visible zone belongs to another account
- no zone of the authorized account is visible
- any route response is missing, rejected, truncated, or ambiguous
- any zone is left uninspected
- any route targets the pinned Worker

On a stop, nothing is created, modified, or deleted, and no cleanup or remediation is attempted.

## Coverage

A Workers route can only reference a script in its own account, so enumerating every zone of the
authorized account enumerates every zone capable of routing to this Worker. Coverage is complete,
not partial.

## Residual

The audit is point-in-time. A route created after it, but before Worker-level Access is installed in
phase 7, is outside the authorized operation. From phase 7 onward, Worker-level Access is the
permanent control for routes, Custom Domains, `workers.dev`, and preview URLs.
