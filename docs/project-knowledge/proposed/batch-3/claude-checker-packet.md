# Independent Claude Checker Packet — Batch 3

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable Draft PR #6 head SHA recorded in the PR description. Refuse a branch name or moving target.

Claude must independently inspect the Batch 3 source package, the accepted Batch 1 and Batch 2 normalization baselines, the machine-readable Batch 3 records, the normalization review, and the exact source provenance fields.

## Required checks

1. Verify all seven package files remain source-only and all five exact originals have stable Library IDs, sizes, SHA-256 digests, and line counts.
2. Confirm the database-reactivation reconciliation adds provenance only, changes no Batch 3 record count, and promotes nothing.
3. Confirm exactly twelve records exist and every package/record is `PROPOSED` and `governing: false`.
4. Verify all twelve taxonomy deltas specialize rather than replace Batch 1's 24-component taxonomy.
5. Verify all ten conflicts, thirteen missing-material items, and ten dependency groups are complete and consistent.
6. Confirm the framework's “source of truth” self-label has no authority.
7. Confirm the Janet2 assumed-transfer versus standalone/no-specialist conflict is quarantined and no internal label selects runtime behavior.
8. Confirm installed and demo modes remain isolated.
9. Confirm isolated/individual trial closes and numeric action targets remain historical and subordinate to layered adequacy, open-ended closing, high intent, and stop states.
10. Confirm GHL fields/actions are mapping evidence only and establish no AutoCalls capability.
11. Confirm every candidate action family fails closed pending capability, destination, authorization, idempotency, limits, result, and fallback contracts.
12. Confirm Cloudflare service authentication remains HMAC/replay-protected with no OAuth dependency and that this PR changes no runtime or deployment configuration.
13. Confirm no credential, token, private key, provider secret, or raw full prompt entered GitHub.
14. Mutation-test every new Batch 3 CI invariant, including source authority, counts, IDs, provenance digests, reconciliation isolation, label conflict, action gate, and OAuth-independence wording.
15. Run `npm test`, `npm run check`, `npm run secret-scan`, and the exact base-to-head `git diff --check`.
16. Report findings by severity with exact file and section evidence.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: BATCH 3 NORMALIZATION ACCEPTED`
- `CLAUDE CHECKER: BATCH 3 NORMALIZATION REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It authorizes no merge, Project Knowledge promotion, final prompt rewrite, deployment, external write, customer-data operation, call, message, campaign, booking, transfer, payment, or workflow.
