# PR #41 Claude Checker Packet

Review the exact pull-request head against its exact base. This is a code-only correction to the repository's pure JSON Schema validator and tests.

Confirm all of the following:

1. `minLength` and `maxLength` count Unicode code points rather than JavaScript UTF-16 code units.
2. ASCII behavior remains identical.
3. A two-character string containing one non-BMP character plus ASCII is accepted at an exact length of two.
4. One- and three-character non-BMP fixtures are rejected by the corresponding lower and upper bounds.
5. Artifact validation independently guards both the Unicode lower-bound rejection and exact upper-bound acceptance.
6. Mutation testing proves reverting to `value.length` fails both the focused suite and artifact validation.
7. The change is relevant to unconstrained Unicode activation-evidence attestations/signatures while preserving ASCII-only orchestrator identifier behavior.
8. No runtime, authentication, Cloudflare, database, migration, binding, deployment, Workflow/Queue, secret, retry, restore, cleanup, deletion, activation, production, customer, Project Knowledge, or master-prompt behavior changes.

Report LGTM or equivalent acceptance only if no actionable finding survives. Otherwise report each exact actionable finding.
