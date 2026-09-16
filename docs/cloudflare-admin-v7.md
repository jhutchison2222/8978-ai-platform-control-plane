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
| `read_development_activation_preflight` | `cloudflare.activation.read` | Reads sanitized account identity, exact D1/Worker/Queue/Workflow state, non-secret bindings, deployments, Access metadata, and secret names/types. |
| `create_development_access_service_token` | `cloudflare.activation.write` | Creates one named service token for at most 24 hours, then installs its credential directly into connector managed secret `CANARY_ACCESS_CREDENTIAL_JSON`. The credential is not returned. |
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

Workers Scripts Write is required only to install the two named managed secrets and deploy the pinned version. No zone permission, DNS permission, account-token administration, or unrelated product permission is required.

## Manual owner checklist after merge

None of these actions is authorized by this code-only issue. Perform them only under a separately reviewed execution authorization.

1. Create a dedicated GitHub OAuth application. Set its callback to `https://8978-cloudflare-admin-v7.jhutchison.workers.dev/callback`.
2. Create a dedicated OAuth KV namespace and replace the placeholder in `wrangler.cloudflare-admin-v7.example.jsonc`.
3. Create the dedicated least-privilege Cloudflare API token described above. Do not reuse a GHL/HighLevel credential.
4. Install `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `CLOUDFLARE_ADMIN_API_TOKEN` as connector Worker secrets. Do not create `CANARY_ACCESS_CREDENTIAL_JSON`; the bounded token tool creates it.
5. Copy the example configuration to an execution-only reviewed configuration. Pin the accepted commit and SHA-256 of `wrangler.jsonc`.
6. Upload, but do not deploy, the reviewed control-plane Worker version with message `8978-reviewed:<commit>:<configuration-sha256>`. Pin the returned version UUID as `REVIEWED_WORKER_VERSION_ID`.
7. Run local tests, artifact validation, secret scan, connector dry run, and one independent exact-head review.
8. Deploy only the connector Worker, reconnect the MCP endpoint at `/mcp-8978-admin-v7`, and complete GitHub OAuth with the allowlisted account.
9. Run the read-only preflight first. Stop on any missing, ambiguous, or mismatched resource.
10. Obtain fresh explicit approval for each write operation. Run each tool at most once and retain only sanitized evidence. The final activation tool consumes the three separate literal approvals for secret installation, exact deployment, and the single canary in one call.

Do not enter a credential value into GitHub, source, fixtures, logs, comments, MCP parameters, or retained evidence.

## Local verification

```sh
npm ci
npm test
npm run check
npm run secret-scan
npm run cf:admin-v7:dry-run
```
