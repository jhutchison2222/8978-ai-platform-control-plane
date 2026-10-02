# PR #40 Claude Checker Packet

Review the exact pull-request head against its exact base. This is a code-only change to the repository's pure JSON Schema validator and tests.

Confirm all of the following:

1. `date-time` requires a complete date, time, and `Z` or numeric timezone offset instead of delegating to JavaScript's permissive parser.
2. Calendar-day, clock, and timezone-offset ranges are checked, including leap-year February.
3. Valid UTC, lowercase `t`, fractional-second, and numeric-offset fixtures remain accepted.
4. Date-only, timezone-free, impossible-calendar, hour-24, and invalid-offset fixtures are rejected.
5. Artifact validation independently guards both explicit date-time shape and real calendar validity.
6. Mutation testing proves bypassing the new predicate fails both the focused suite and artifact validation.
7. Existing type, length, pattern, and other schema-keyword behavior remains unchanged.
8. No runtime, authentication, Cloudflare, database, migration, binding, deployment, Workflow/Queue, secret, retry, restore, cleanup, deletion, activation, production, customer, Project Knowledge, or master-prompt behavior changes.

Report LGTM or equivalent acceptance only if no actionable finding survives. Otherwise report each exact actionable finding.
