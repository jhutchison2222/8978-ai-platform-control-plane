# Independent Claude Checker Packet — PR #36 Schema Query Evidence Consistency

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT A BRANCH OR MAKER SUMMARY

Candidate commit: use the immutable PR #36 head SHA recorded in the PR description.

## Required checks

1. Re-derive exact ancestry, tree, diff scope, file modes, and digests from the PR #35 merge base.
2. Confirm the change is limited to the pure schema-inventory verification-record validator, its focused Node tests, artifact guards, contract documentation, and this checker packet.
3. Confirm every query-result digest exists if and only if its corresponding observation is marked retrieved.
4. Confirm an execution claiming `SUCCEEDED` invokes the complete ordered six-query pass and carries all six result digests.
5. Confirm a fully evidenced but independently unaccepted successful pass remains honestly representable as `INCONCLUSIVE_READ_ONLY`.
6. Confirm stopped and failed/interrupted/ambiguous outcomes retain their established fail-closed behavior.
7. Mutation-test removal of the digest/observation equivalence and successful-completeness clauses; the focused tests and artifact validation must fail.
8. Confirm no schema-verification record instance exists and no runtime, deployment, migration, binding, HMAC authentication, Project Knowledge, or master-prompt source changes.
9. Run the full npm/check/secret/types/dry-run suite and exact base-to-head `git diff --check` without executing any remote operation.
10. Perform no Cloudflare API call, remote Wrangler command, D1 query, SQL execution, migration, binding, deployment, Workflow/Queue operation, secret/key operation, retry, restore, cleanup, deletion, activation, or production/customer action.

## Required terminal result

End with exactly one terminal line:

- `CLAUDE CHECKER: PR #36 SCHEMA QUERY EVIDENCE CONSISTENCY ACCEPTED`
- `CLAUDE CHECKER: PR #36 SCHEMA QUERY EVIDENCE CONSISTENCY REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit and authorizes no merge or external action.
