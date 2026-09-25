# Development Worker bootstrap creation (phases 1-3)

`8978-ai-control-plane-dev` does not exist on account `de5e0273347b0b4c5f8f4e554aa2288f`. Two
Cloudflare constraints make this a bootstrap problem rather than an ordering problem:

- `wrangler versions upload` cannot create a Worker that does not exist.
- Durable Object lifecycle migrations are applied by `wrangler deploy`, not by a version upload.

Admin v7 additionally requires an undeployed `TARGET_WORKER_VERSION_ID` before activation, which
cannot exist until the Worker does.

## Resolution: create with no public surface

`wrangler.bootstrap.jsonc` is byte-identical to the reviewed `wrangler.jsonc` except for one key:

```
"workers_dev": false
```

`preview_urls` is already `false` in both. The bootstrap deploy therefore creates the Worker,
applies migration tags `v1` and `v2`, and registers the Workflow, while creating **no reachable
surface at all**.

### Why both keys must be explicit

Wrangler computes `workers_dev = config_workers_dev ?? (routes.length === 0)`. Omitting the key with
no routes defaults it to **true**. `preview_urls` defaults to match `workers_dev` from Wrangler
v4.44.0. Both keys are therefore explicitly `false`, and `scripts/validate-artifacts.js` fails if
either is absent or not `false`.

## Provenance identities

| Identity | Value |
| --- | --- |
| Target Worker reviewed commit | `371b02d797528f175e9e6075aef6fc92757dfd52` |
| Target configuration SHA-256 | `f011600fb1835dcdf9f6491f4b27613004e58e37a1cd5ef9b2b5697859ab40a6` |
| Bootstrap configuration SHA-256 | `9f9cd5ee1a388d0a50959f9fc68a2c2efecdb6e05ed7bdac1bfae9559d434e8d` |
| Remediation commit | supplied externally in the owner authorization |

The remediation commit is **never** written into a tracked reviewed file: a commit cannot contain
its own SHA. `deployment/development-worker-bootstrap-creation-packet.json` pins
`remediationCommit: null`, its schema rejects a 40-hex value in that field, and the verifier requires
`git rev-parse HEAD` to equal the externally supplied SHA at execution time.

## Two checkouts

**Remediation checkout** — at the externally authorized remediation commit:

```sh
git rev-parse HEAD                       # must equal the authorized SHA
git status --porcelain                   # must be empty
node scripts/validate-artifacts.js
node scripts/verify-target-runtime-closure.js --against 371b02d797528f175e9e6075aef6fc92757dfd52
# only when separately authorized:
npx wrangler deploy --config wrangler.bootstrap.jsonc --strict --message "8978-bootstrap:371b02d797528f175e9e6075aef6fc92757dfd52:9f9cd5ee1a388d0a50959f9fc68a2c2efecdb6e05ed7bdac1bfae9559d434e8d"
```

**Reviewed target checkout** — LF-exact at `371b02d797528f175e9e6075aef6fc92757dfd52`, a separate
directory, its own `npm ci` from the byte-identical lockfile:

```sh
npx wrangler versions upload --config wrangler.jsonc --strict \
  --message "8978-reviewed:371b02d797528f175e9e6075aef6fc92757dfd52:f011600fb1835dcdf9f6491f4b27613004e58e37a1cd5ef9b2b5697859ab40a6"
```

No remediation file is copied or substituted into the reviewed upload tree. The remediation
validator reads the reviewed tree and Git objects read-only.

Digests must be computed from canonical LF content. On a `core.autocrlf=true` checkout the working
copy is CRLF and will not match the reviewed digests; `normalizedFileDigest` handles this.

## Verification (phase 2-3)

```sh
node scripts/verify-development-worker-bootstrap.js --remediation-commit <AUTHORIZED_REMEDIATION_SHA> --bootstrap-version-id <BOOTSTRAP_VERSION_ID>
```

Both arguments are required and are supplied at execution time; neither is tracked.
`<AUTHORIZED_REMEDIATION_SHA>` is the externally authorized remediation commit, which must equal
`git rev-parse HEAD`. `<BOOTSTRAP_VERSION_ID>` is the lowercase UUID that the single bootstrap deploy
prints as its `Current Version ID`; the active deployment and `versions/latest` must both identify
exactly that version. A missing flag, a missing value, a repeated flag, an unrecognized argument, or
a malformed value stops before any request is made.

The three commands above are pinned exactly, as schema `const` values, in
`schemas/development-worker-bootstrap-creation-packet.schema.json` (`authorizedCommands`) and are
checked for exact equality by `npm run check`. Any changed flag, target, configuration path, or
omitted safety option fails validation.

GET-only across twelve endpoints. It confirms the account and Worker, the immutable Worker ID and
its stable `tag` cross-check, exactly one active deployment at 100% identifying the bootstrap
version, the exact bootstrap annotation, the D1 / Queue / Workflow / four Durable Object bindings,
`migration_tag === "v2"`, absence of `SERVICE_AUTH_KEYS_JSON` by name, zero Custom Domains, zero
Queue consumers, and `enabled: false` / `previews_enabled: false`.

Zero Custom Domains is proven with the connector's shared fail-closed rule: the listing is requested
with the documented `service=8978-ai-control-plane-dev` filter, and only an empty result whose
`result_info` reports page 1, a valid `per_page`, and `count` and `total_count` both zero is accepted.
A record for the Worker, a record for another Worker (the filter was not honored), missing or
contradictory metadata, or a nonzero `total_count` behind an empty result stops verification.

It writes no record. The owner authors it against
`schemas/development-worker-bootstrap-verification-record.schema.json`.

### Why `migration_tag` must be exactly `v2`

Wrangler's `getMigrationsToUpload` sends a migration payload only when the script's current tag is
not the last configured tag. With the tag already at `v2`, the phase-4 `versions upload` sends no
migrations. Any other value is a stop.

## Limitations

Repository byte-identity to the target commit is proven. Continuity across phases is proven by
`resources.script.etag`. Derivation of the deployed bundle from the target commit is **not** provable:
Cloudflare exposes no reproducible build digest and esbuild output is not byte-reproducible across
environments. The bootstrap annotation is an owner attestation of intent, not a derivation proof.
