# Read-Only Authority Runtime Composition

Status: DEVELOPMENT FOUNDATION ONLY — CODE-COMPOSED, CONFIGURATION-UNBOUND, AND NOT DEPLOYED

PR #13 composes the eight previously reviewed D1 authority dependencies into one development runtime boundary. It creates no database, adds no Wrangler binding, applies no remote migration, installs no key or record, and enables no action execution.

## Composition boundary

`createD1AuthorityRuntimeDependencies()` accepts one injected D1 binding and constructs:

- authoritative resource resolution;
- digest-bound trusted limits;
- Ed25519 maker/checker identity verification;
- digest-bound required-test evidence;
- executable rollback verification;
- governing Project Knowledge reads;
- Ed25519 owner-decision verification; and
- standing-policy state and kill-switch revalidation.

Every dependency retains the read-only, integrity-checking behavior reviewed in PRs #9–#12. The returned dependency map is frozen. The standing-state method is bound to its validated adapter instance, and the governing Project Knowledge scope remains constructor-fixed to `control-plane`.

## Development runtime behavior

`createDevelopmentRuntime()` composes these readers only when an injected environment contains an `AUTHORITY_DB` object with the D1 `prepare()` contract. Without that binding, the existing throwing unavailable adapters remain in place and evaluation fails closed.

The Workers test environment injects a real local D1 binding plus local Workflow and Queue bindings, so every dependency contract is composed there while readiness deliberately remains `false`. The checked-in `wrangler.jsonc` still has none of those bindings, so the deployable configuration continues to report authority and orchestrator dependencies unavailable.

## Deliberately not activated

- `wrangler.jsonc` contains no `d1_databases` entry, database name, database ID, preview database ID, account ID, or route.
- The existing `pk-d1-dev` database is not reused as runtime authority storage.
- The five authority migrations remain unapplied outside the local Workers test runtime.
- No authority writer, promotion path, seed data, private key, secret, Workflow, Queue, or provider binding is added.
- `ALLOW_EXTERNAL_WRITES` remains `false`, and `/v1/actions/execute` remains an unconditional `execution_disabled` response.

A later owner-authorized infrastructure PR must use a dedicated, authoritative development D1 database identifier and independently reviewed migration/rollback evidence before adding a Wrangler binding.
