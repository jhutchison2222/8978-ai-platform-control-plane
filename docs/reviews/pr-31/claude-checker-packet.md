# Independent Claude Checker Packet — PR #31 Schema Inventory Verification Record Contract

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT A BRANCH OR MAKER SUMMARY

Candidate commit: use the immutable draft PR #31 head SHA recorded in the PR description.

## Required checks

1. Re-derive exact ancestry, tree, diff scope, file modes, and digests from the PR #30 merge base.
2. Confirm the reviewed PR #30 packet commit and SHA-256, authorized development account, exact database identity, ordered queries, tables, indexes, migrations, and foreign key are pinned.
3. Confirm no verification-record instance exists and no Cloudflare query or other external operation is authorized or performed.
4. Confirm `VERIFIED` requires one authorized read-only attempt, exact accepted migration prerequisite, all six query-result digests, complete matching observations, zero authority rows, integrity `ok`, and an accepting checker distinct from the operator.
5. Confirm `STOPPED_NO_QUERY` requires zero invocation and cannot carry evidence or conclusions.
6. Confirm `INCONCLUSIVE_READ_ONLY` requires an invoked ordered-prefix read-only pass, an error, and cannot promote verification or independent acceptance.
7. Confirm every outcome prohibits activation-plan updates, mutations, adjacent effects, retries, restores, cleanup, and deletion.
8. Empirically mutation-test status boundaries, query ordering, missing evidence, identity/inventory/foreign-key/integrity/row-count drift, checker independence, prerequisite drift, conclusion promotion, runtime import, source-packet drift, deployable-config drift, and unexpected properties.
9. Remove key validator clauses in scratch mutations and confirm both focused tests and `npm run check` fail, then restore a clean tree.
10. Run the full npm/check/secret/types/dry-run suite and exact base-to-head `git diff --check`.
11. Perform no Cloudflare API call, remote Wrangler command, D1 query, SQL execution, GitHub mutation, or other external operation.

## Required terminal result

End with exactly one terminal line:

- `CLAUDE CHECKER: PR #31 SCHEMA INVENTORY VERIFICATION RECORD CONTRACT ACCEPTED`
- `CLAUDE CHECKER: PR #31 SCHEMA INVENTORY VERIFICATION RECORD CONTRACT REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit and authorizes no merge or external action.
