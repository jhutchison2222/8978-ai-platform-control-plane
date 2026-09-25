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
all pages (`page`/`per_page`), stopping on missing, inconsistent, repeated, truncated, or ambiguous
pagination. Both Cloudflare V4 page-pagination forms are accepted: `result_info` must carry `page`,
`per_page`, and `total_count`, and the page count is always derived as
`ceil(total_count / per_page)`; a supplied `total_pages` must equal that derived count. There is no
single-page fallback when metadata is missing. Hostname and path Access applications
take precedence over Worker-level Access, so any other application whose `domain`,
`self_hosted_domains`, `public` destination, or other hostname declaration equals the target
hostname, scopes a path on it, or is a wildcard that could match it is a conflict. Coverage that
cannot be determined is also a conflict. A single trailing dot (the fully qualified form) is removed
before comparison, and any other empty label makes a declaration uninterpretable, so a trailing-dot
hostname cannot evade detection. Any conflict stops before the POST; no attempt is made to prove that
a conflicting application's policies are harmless. The expected Worker-level application must also
not enable `options_preflight_bypass`, which would let CORS preflight requests reach the Worker
without Access.

### Activated-version provenance

The reviewed commit, configuration digest, and reviewed version ID come only from the connector's
pinned configuration (`TARGET_WORKER_COMMIT`, `TARGET_CONFIGURATION_SHA256`,
`TARGET_WORKER_VERSION_ID`), which must equal the target Worker provenance. A caller-supplied
`activatedVersionId` is never trusted by itself. Before the POST the connector requires that:

- the active deployment allocates exactly 100% to `activatedVersionId` and to no other version;
- `GET` of the reviewed version returns it with exactly `8978-reviewed:<commit>:<configuration-sha256>`;
- `GET` of the activated version returns it with exactly `8978-activated:<commit>:<configuration-sha256>`;
- `versions/latest` is exactly the activated version with that same annotation;
- the activated version passes the phase-7 continuity rule against the reviewed version: the same
  non-empty script etag, the same script runtime, the same bindings, and exactly one added
  `SERVICE_AUTH_KEYS_JSON` secret.

Missing, duplicate, contradictory, or ambiguous metadata stops before the POST.

### Ordering

1. Identity, pre-enablement surface, deployment, provenance, hostname, Access isolation, and the
   pinned service token.
2. Both custody values, retrieved and bound to the exact phase-8 inputs: the Access credential to
   its receipt, the account, the Worker name, the target, and the exact service-token ID, and it
   must not be expired; the service-auth principal to its receipt, the account, the Worker name, the
   immutable Worker ID, the pinned principal ID, the exact key ID, and the canary purpose.
3. A final re-read of the active deployment (same deployment ID and version) and of
   `versions/latest`, so the last observable state before enablement is still the authorized version.
4. Exactly one POST.
5. Exactly one read-back GET on every POST outcome — verification, never a retry.
6. The five-request canary, once, only after an unambiguous successful read-back.

Any failure in steps 1-3 stops with no POST, no read-back, and no canary request. No secret value
is returned, logged, or included in an error.

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
| Activated-version provenance fails | Unreachable | Stop before the POST |
| Canary custody unavailable or mismatched | Unreachable | Stop before the POST |
| Deployment changes before the POST | Unreachable | Stop before the POST |
| POST clearly fails, read-back false/false | Unreachable | Stop |
| POST ambiguous, read-back true/false | Reachable, Access-protected | Stop before canary |
| POST ambiguous, read-back false/false | Unreachable | Stop; never repeat the POST |
| Read-back reports previews enabled | Reachable, unintended | Security stop |
| Read-back fails or is ambiguous | Assume reachable | Stop; report sanitized state |
| Canary fails after enablement | Reachable, Access-protected | Stop; report sanitized state |

No branch retries, disables, cleans up, restores, or rolls back. On canary failure the subdomain is
deliberately left enabled: disabling it would be a rollback, and Access — not subdomain removal — is
the control that must remain proven active.
