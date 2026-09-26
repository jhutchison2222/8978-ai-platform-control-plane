# Cloudflare Admin OAuth v7 activation bridge

Status: CODE AND TESTS ONLY — NOT DEPLOYED

This is a separate OAuth-protected MCP Worker for the one reviewed development activation. It does not change the existing control-plane Worker configuration and it is not a general Cloudflare administration proxy.

## Fixed boundary

The source pins these identities and rejects caller-selected alternatives:

- account `de5e0273347b0b4c5f8f4e554aa2288f`
- Worker `8978-ai-control-plane-dev`
- URL `https://8978-ai-control-plane-dev.jhutchison.workers.dev`
- D1 `8978-ai-authority-dev` / `741ade94-8539-4fc8-b6be-24884720dee8`
- Queue `8978-ai-orchestrator-dev`
- Workflow `8978-ai-orchestrator-dev` / class `OrchestratorWorkflow`
- target secret `SERVICE_AUTH_KEYS_JSON`
- connector Worker `8978-cloudflare-admin-v7`
- MCP path `/mcp-8978-admin-v7`

All Cloudflare requests use a dedicated `CLOUDFLARE_ADMIN_API_TOKEN`. No HighLevel or GHL credential is accepted. The API adapter permits only fixed `GET`, `POST`, `PUT`, and `PATCH` operations; it has no deletion, cleanup, rollback, restore, retry, DNS, custom-domain, production, customer, or arbitrary REST operation.

## Authentication

The connector follows the working `ghl-config-auditor-mcp` pattern without copying its HighLevel surface:

- GitHub OAuth authentication with exact `ALLOWED_GITHUB_LOGIN` matching
- OAuth 2.1 authorization-code flow with S256 PKCE (plain PKCE and implicit flow disabled)
- dedicated `OAUTH_KV` storage for OAuth grants, clients, tokens, and short-lived callback state
- Client ID Metadata Documents plus dynamic client registration compatibility
- RFC 9728 protected-resource metadata and RFC 8414 authorization-server metadata
- public MCP initialization and tool discovery before authorization
- MCP `mcp/www_authenticate` challenge results for unauthenticated tool calls
- separate read and write scopes

The callback consumes its state once, compares the state cookie without an early-exit string comparison, verifies the GitHub login, and grants only requested supported scopes.

## Exact tool inventory

| Tool | OAuth scope | Effect |
|---|---|---|
| `read_development_activation_preflight` | `cloudflare.activation.read` | Reads sanitized account identity, exact D1/Worker/Queue/Workflow state, non-secret bindings, deployments, the Worker-level Access application for the verified immutable Worker ID (never other applications in the account), and secret names/types. |
| `create_development_access_service_token` | `cloudflare.activation.write` | Creates one named service token for at most 24 hours, verifies it by an exact-ID read-back (which supplies the mandatory `expires_at` the creation response lacks) and a complete pinned-name listing, then installs its credential directly into connector managed secret `CANARY_ACCESS_CREDENTIAL_JSON`. Any failure from the POST onward, including a failed or ambiguous POST, stops as an owner-review partial state with no retry or cleanup. The credential is not returned. |
| `ensure_development_access_protection` | `cloudflare.activation.write` | Creates or confirms one self-hosted Access application for the exact workers.dev hostname and adds a service-token-only policy using the exact previously created token ID. |
| `activate_exact_reviewed_development_worker` | `cloudflare.activation.write` | Requires three exact approvals, confirms the pinned reviewed version is still latest and has never been deployed, derives one new version containing only `SERVICE_AUTH_KEYS_JSON`, deploys that derived version at 100%, and immediately runs the exact five-request canary once while the HMAC exists only in memory and the target managed secret. |

Every write operation requires the exact literal approval value exported in `WRITE_APPROVALS`; the final activation tool requires the secret-install, deployment, and canary approvals together. A near match, alternate target, duplicate resource, partial state, or unexpected response stops the operation. The connector never automatically retries, cleans up, deletes, restores, or rolls back.

Cloudflare's ordinary secret operation immediately deploys a new Worker version. The bridge therefore uses the versioned-secret operation instead: it verifies the pre-uploaded reviewed version is still the latest version, creates a new undeployed version by adding only the HMAC secret, then verifies the derived version ID, annotation, code etag, runtime settings, and complete non-secret binding set before deploying it and issuing the canary. These steps are one tool call because the generated HMAC is never persisted anywhere the connector could read later.

## Canary contract

The final tool issues exactly these requests through the Access service token:

1. unsigned `GET /v1/runtime/readiness` → `401 service_authentication_failed`
2. signed `GET /v1/runtime/readiness` → `200`, development mode, external writes false, no missing authoritative dependencies
3. the identical signed request from step 2 → `401 service_authentication_failed`
4. signed synthetic `POST /v1/actions/evaluate` → `200 authoritative_resolution_unavailable`
5. signed `POST /v1/actions/execute` with `{}` → `503 execution_disabled`

It stops on the first mismatch. Returned evidence contains only sequence, timestamp, method, path, status, and response JSON. Access credentials, HMAC values, signatures, and signed headers are never included.

## Dedicated Cloudflare API token permissions

Scope the token to account `de5e0273347b0b4c5f8f4e554aa2288f` only. Grant only:

- Account Settings: Read
- D1: Read
- Workers Scripts: Read and Write
- Workers Queues: Read
- Workers Workflows: Read
- Access: Apps and Policies Read and Write
- Access: Service Tokens Read and Write

Workers Scripts Write is required only to install the named managed secrets, deploy the pinned version, and make the single `workers.dev` subdomain enablement request. Worker-level Access uses the Access permissions above. No zone permission, DNS permission, account-token administration, or unrelated product permission is required.

The pre-bootstrap route audit (phase 0) is the one operation that needs zone scope. It uses a **separate temporary** credential with `Zone Read` and `Workers Routes Read` only, never `Workers Routes Write`. That credential is never given to this connector, and no zone permission is added to this token.

## Manual owner checklist after merge

None of these actions is authorized by this code-only issue. Perform them only under a separately reviewed execution authorization.

`8978-ai-control-plane-dev` does not yet exist. The ordering below is bootstrap-safe: no public
surface exists at any point before Worker-level Access is installed. See
[the bootstrap creation doc](development-worker-bootstrap-creation.md),
[the route audit doc](development-worker-route-audit.md), and
[the subdomain enablement doc](development-worker-subdomain-enablement.md).

0. Run the read-only all-zone route audit with a **separate temporary** `Zone Read` +
   `Workers Routes Read` credential: `node scripts/audit-development-worker-routes.js`. Require zero
   routes targeting the Worker. Never grant `Workers Routes Write`, and never add zone permission to
   the runtime or connector token.
1. Deploy the bootstrap Worker once, with no public surface:
   `npx wrangler deploy --config wrangler.bootstrap.jsonc --strict --message "8978-bootstrap:371b02d797528f175e9e6075aef6fc92757dfd52:9f9cd5ee1a388d0a50959f9fc68a2c2efecdb6e05ed7bdac1bfae9559d434e8d"`.
   This creates the Worker, applies Durable Object migrations `v1` and `v2`, and registers the
   Workflow, with `workers_dev` and `preview_urls` both `false`.
2. Resolve and pin the immutable Worker ID from `GET /accounts/{account_id}/workers/workers`,
   requiring an exact single name match, a 32-hex id, confirmation through
   `GET /accounts/{account_id}/workers/workers/{worker_id}`, and agreement with the stable Worker
   script `tag`. The legacy script endpoint returns the name as its `id` and is never the source.
3. Run the owner-run local verifier — not Admin v7 —
   `node scripts/verify-development-worker-bootstrap.js --remediation-commit <AUTHORIZED_REMEDIATION_SHA> --bootstrap-version-id <BOOTSTRAP_VERSION_ID>`, where `<BOOTSTRAP_VERSION_ID>` is the `Current Version ID` printed by step 1.
   It is GET-only and writes no record.
4. From an LF-exact checkout of the target commit, upload but do not deploy the reviewed version with
   message `8978-reviewed:<target-commit>:<configuration-sha256>`. Pin the returned UUID as
   `TARGET_WORKER_VERSION_ID`. No remediation file may be copied into that tree.
5. Create a dedicated GitHub OAuth application with callback
   `https://8978-cloudflare-admin-v7.jhutchison.workers.dev/callback`, a dedicated OAuth KV
   namespace, and the least-privilege Cloudflare API token described above. Do not reuse a
   GHL/HighLevel credential.
6. Install `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `CLOUDFLARE_ADMIN_API_TOKEN` as connector
   Worker secrets. Do not create `CANARY_ACCESS_CREDENTIAL_JSON` or
   `CANARY_SERVICE_AUTH_PRINCIPAL_JSON`; the bounded tools create them in their own distinct slots.
7. Deploy only the connector Worker, reconnect the MCP endpoint at `/mcp-8978-admin-v7`, and complete
   GitHub OAuth with the allowlisted account. Run local tests, artifact validation, secret scan,
   target-runtime closure verification, connector dry run, and one independent exact-head review.
8. Run the read-only preflight. It is satisfiable before and after bootstrap and stops on any
   missing, ambiguous, or mismatched resource.
9. Under their own literal approvals, create the bounded Access service token and the Worker-level
   Access application with exactly one service-token-only Service Auth policy, while `workers.dev`
   remains disabled. Then, under two further literal approvals, create the secret-bearing version and
   deploy it at 100%; the Worker stays unreachable and the call reports `reachable: false`.
10. Under its own literal approval, make exactly one subdomain enablement request
    (`enabled: true`, `previews_enabled: false`), read the state back exactly once, and only then run
    the five-request canary once. Retain only sanitized evidence. No step retries, disables, cleans
    up, restores, or rolls back.

Do not enter a credential value into GitHub, source, fixtures, logs, comments, MCP parameters, or retained evidence.

## Local verification

```sh
npm ci
npm test
npm run check
npm run secret-scan
npm run cf:admin-v7:dry-run
```
