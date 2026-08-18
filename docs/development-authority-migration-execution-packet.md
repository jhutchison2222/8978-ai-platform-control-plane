# Development Authority Migration Execution Packet

Status: PLANNING AND REVIEW ONLY — EXECUTION IS NOT AUTHORIZED

This packet defines the next bounded infrastructure phase after development D1 and Queue resource reconciliation. It performs no Cloudflare action, changes no deployable Worker configuration, and is not imported by runtime or preflight code.

## Backup boundary

Cloudflare D1 Time Travel is always enabled for databases on the `production` storage backend and provides point-in-time bookmarks. Before any migration, an authorized operator must retrieve and preserve the current bookmark with `wrangler d1 time-travel info`. The operator must also create an ephemeral, untracked SQL export and record its SHA-256 digest and byte size. The export must not be committed because future exports could contain authority or customer-sensitive data.

Cloudflare documents Time Travel at <https://developers.cloudflare.com/d1/reference/time-travel/> and D1 migrations at <https://developers.cloudflare.com/d1/reference/migrations/>.

A restore overwrites the database in place and is destructive. This packet does not authorize a restore, automatic restore, or deletion. A later emergency restore would require a new exact owner decision.

## Migration-only configuration

`deployment/wrangler.authority-migrations.jsonc` exists only so Wrangler can find the exact six files under `migrations/authority`. It pins the exact development D1 name and UUID and has no Worker entry point, routes, Queue, Workflow, service, secret, environment variables, Durable Objects, or deployment settings. It is not `wrangler.jsonc`, is never imported by runtime code, and does not install a runtime binding.

Wrangler's migration system records applied filenames in its `d1_migrations` bookkeeping table. Those bookkeeping rows are expected platform migration state; none of the six reviewed SQL files contains `INSERT`, `UPDATE`, or `DELETE`, and no authority, Project Knowledge, key, policy, validation, owner, or activation-evidence record is seeded.

## One-attempt sequence

After a later authorization pins the exact reviewed commit, packet digest, and Cloudflare account ID, the operator must:

1. verify authenticated account identity and exact D1 identity/state;
2. capture the current Time Travel bookmark;
3. create and hash the ephemeral untracked SQL export;
4. verify the exact six pending migrations and their order;
5. invoke the pinned migration-apply command once;
6. verify that Wrangler reports no pending migrations; and
7. stop and prepare a code-only execution record.

Any ambiguity, mismatch, interruption, or partial result is a hard stop. There is no automatic retry, restore, cleanup, plan update, schema-certification claim, binding, deployment, or continuation.

## Continuing safety boundary

Even after a successful migration, the resource-reconciled activation plan remains unchanged: `migrationsApplied:false`, `remoteSchemaVerified:false`, every binding false, Workflow creation false, evidence null, deployment unauthorized, and activation unauthorized. Later reviewed records must reconcile the migration result and separately verify the remote schema before any binding or deployment phase.
