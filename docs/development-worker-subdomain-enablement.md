# Development Worker subdomain enablement (phases 7-10)

Neither a version upload nor a version deployment enables `workers.dev`. Wrangler writes the
subdomain only from its deploy path, and the connector's `createWorkerDeployment` posts exactly
`{ versions: [{ percentage: 100, version_id }] }`. Enabling the public surface is therefore an
explicit, separately approved write:

```
POST /accounts/{account_id}/workers/scripts/{script_name}/subdomain
{ "enabled": true, "previews_enabled": false }
```

`setWorkerSubdomain` is the only writer in the adapter, it refuses any body other than
`enabled: true` with `previews_enabled: false`, and it carries the dated
`Cloudflare-Workers-Script-Api-Date: 2025-08-01` header.

## Two credential kinds, two slots

Phase 7 and phase 8 are separate connector invocations, so the canary's signing principal must
survive between them. The custodian holds exactly two credential kinds in **distinct** managed
secrets that can never alias or overwrite each other:

| Kind | Slot |
| --- | --- |
| `access-service-token` | `CANARY_ACCESS_CREDENTIAL_JSON` |
| `service-auth-principal` | `CANARY_SERVICE_AUTH_PRINCIPAL_JSON` |

Every other kind is refused. The custodian has no list-all, export, reveal, delete, rotation, or
fallback-lookup capability, and the Access credential is never reusable as service authentication.

The stored principal is bound to the account, the Worker name, the verified immutable Worker ID, the
exact `SERVICE_AUTH_KEYS_JSON` key ID, and the development activation-canary purpose. Retrieval
re-checks every one of those.

## Phase 7 custody ordering (fail-closed)

1. Generate the bounded principal in memory.
2. Store it in its dedicated slot.
3. Confirm custody **by secret name only** — no value is read, returned, or logged.
4. Only then create the secret-bearing version and deploy it at 100%.
5. Re-assert `enabled: false` / `previews_enabled: false` and report `reachable: false`.

If storage or custody confirmation fails or is ambiguous, the secret-bearing version is never
created and nothing is deployed.

## Phase 8-10

Before the single POST, the connector reverifies the account and Worker, the independently resolved
immutable Worker ID, the active deployment allocating 100% to exactly the expected activated
version, and the Access application shape: `self_hosted`, exactly one destination of type `worker`
pinning the verified Worker ID, exactly one `non_identity` Service Auth policy including exactly the
pinned service token, and no additional include, exclude, or require rules.

It then derives the target hostname from verified account state
(`GET /accounts/{account_id}/workers/subdomain`, which must yield exactly
`8978-ai-control-plane-dev.jhutchison.workers.dev`) and enumerates **every** Access application across
all pages (`page`/`per_page`, bounded by `result_info.total_pages`), stopping on missing,
inconsistent, repeated, truncated, or ambiguous pagination. Hostname and path Access applications
take precedence over Worker-level Access, so any other application whose `domain`,
`self_hosted_domains`, `public` destination, or other hostname declaration equals the target
hostname, scopes a path on it, or is a wildcard that could match it is a conflict. Coverage that
cannot be determined is also a conflict. Any conflict stops before the POST; no attempt is made to
prove that a conflicting application's policies are harmless.

Then exactly one POST, exactly one read-back GET — verification, never a retry — and only then the
five-request canary, once.

## Approvals

| Approval | Literal |
| --- | --- |
| Access | `APPROVE WORKER-LEVEL ACCESS PROTECTION FOR 8978-ai-control-plane-dev` |
| Secret install | `APPROVE SERVICE_AUTH_KEYS_JSON FOR 8978-ai-control-plane-dev` |
| Deploy | `APPROVE EXACT REVIEWED COMMIT DEPLOYMENT TO 8978-ai-control-plane-dev` |
| Subdomain | `APPROVE WORKERS.DEV SUBDOMAIN ENABLEMENT FOR 8978-ai-control-plane-dev` |
| Canary | `APPROVE ONE FIVE-REQUEST CANARY FOR 8978-ai-control-plane-dev` |

Bootstrap creation is owner-run Wrangler and carries **no** connector approval literal.

## Failure states

| Outcome | Classification | Action |
| --- | --- | --- |
| Custody unconfirmed | Unreachable, nothing deployed | Stop |
| Access reverification fails | Unreachable | Stop before the POST |
| POST clearly fails, read-back false/false | Unreachable | Stop |
| POST ambiguous, read-back true/false | Reachable, Access-protected | Stop before canary |
| POST ambiguous, read-back false/false | Unreachable | Stop; never repeat the POST |
| Read-back reports previews enabled | Reachable, unintended | Security stop |
| Read-back fails or is ambiguous | Assume reachable | Stop; report sanitized state |
| Canary fails after enablement | Reachable, Access-protected | Stop; report sanitized state |

No branch retries, disables, cleans up, restores, or rolls back. On canary failure the subdomain is
deliberately left enabled: disabling it would be a rollback, and Access — not subdomain removal — is
the control that must remain proven active.
