# PR #38 Claude Checker Packet

Review the exact pull-request head against its exact base. This is a code-only change to the repository's pure JSON Schema validator and tests.

Confirm all of the following:

1. `maximum` rejects only numeric values above the inclusive upper bound and preserves existing `minimum` behavior.
2. `maxItems` rejects only arrays longer than the inclusive upper bound and preserves existing `minItems` and item validation.
3. Focused tests cover both accepted boundaries and rejected underflow/overflow cases.
4. Representative reviewed artifact schemas now reject oversized `stopConditions` and `verification.limitations` arrays.
5. Artifact validation independently guards both new upper-bound behaviors.
6. Mutation testing proves disabling the two new checks fails both the focused suite and artifact validation.
7. No runtime, authentication, Cloudflare, database, migration, binding, deployment, Workflow/Queue, secret, retry, restore, cleanup, deletion, activation, production, customer, Project Knowledge, or master-prompt behavior changes.

Report LGTM or equivalent acceptance only if no actionable finding survives. Otherwise report each exact actionable finding.
