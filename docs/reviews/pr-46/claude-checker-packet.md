# Independent Claude Checker Packet — PR #46 Read-Only Schema Inventory Execution Mechanism

Status: CHECKER REQUEST — REVIEW THE EXACT PR HEAD, NOT A BRANCH OR MAKER SUMMARY

## Required checks

1. Re-derive ancestry, tree, diff scope, file modes, and digests from merge commit `5d34fd3eb39b37c5dca6a64afd0469478390a808`.
2. Confirm the workflow checks out immutable runner commit `cf1bdb9f890a7a00a005f68921cf0de7198d453c` and accepts only the owner, `main`, and exact phrase `VERIFY AUTHORITY SCHEMA READ ONLY ONCE`.
3. Confirm the runner pins packet commit `79bf051947019a0703e6095d71bc3d926612c76b`, packet SHA-256 `bf95a3168ea30273f428e6a8426a0b16a8d05e8c537587925d990254778b7376`, accepted migration-record SHA-256 `627dcf833b0ba5db15729e3916c246724f4f90c2919e374a4c3e4faeafaf16f1`, account `de5e0273347b0b4c5f8f4e554aa2288f`, and database UUID `741ade94-8539-4fc8-b6be-24884720dee8`.
4. Confirm identity and metadata checks complete before SQL and the runner invokes exactly one ordered pass of the reviewed definitions, migration-name, foreign-key, integrity, and aggregate row-count queries.
5. Confirm each SQL command is checked against a narrow read-only allowlist and no mutating SQL, migration, export, binding, deploy, Workflow, Queue, secret/key, restore, retry, cleanup, deletion, production, or customer operation exists.
6. Confirm credentials are scoped only to the runner step, evidence is initialized before fallible validation, raw Wrangler identity output is not uploaded, and the artifact contains only sanitized database metadata, schema definitions, inventories, aggregate count, and digests.
7. Confirm success produces a schema-valid `INCONCLUSIVE_READ_ONLY` candidate record with every conclusion false and independent review pending; it must not self-certify `VERIFIED`.
8. Mutation-test the exact owner phrase, execution commit, account ID, database UUID, packet and migration-record digests, SQL allowlist, one-attempt boundary, and prohibited adjacent operations.
9. Run the full npm/check/secret/types/dry-run suite and exact base-to-head `git diff --check` without performing any remote Cloudflare operation.

Acceptance authorizes only merging this code-only execution mechanism. It does not authorize the workflow run, a D1 query, evidence acceptance, activation-plan change, binding, deployment, production action, or customer action.
