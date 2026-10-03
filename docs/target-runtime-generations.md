# Target-runtime generations

This document defines the formal model for how the reviewed target Worker runtime evolves over
time, and the dependency-reproducibility policy that applies to new tooling and future
generations. It exists so that "we need to change a dependency" is never answered by quietly
editing an already-reviewed generation's files.

## The generation model

A **target-runtime generation** is the complete, exact, independently-reviewed set of facts about
one version of the deployed Worker runtime:

- an exact source commit;
- an exact configuration digest (`wrangler.jsonc`);
- an exact runtime-input manifest (every source file the Worker's module graph reaches, each
  pinned by digest);
- an exact migration set;
- an exact dependency snapshot (`package.json` / `package-lock.json`, pinned by digest);
- the review evidence that accepted it;
- the activation/canary evidence that proved it live correctly.

All of this is encoded in `src/target-runtime-manifest.js` and enforced on every PR, forever, by
`scripts/validate-artifacts.js` and `scripts/verify-target-runtime-closure.js`.

### Generation 1 — immutable historical artifact

```
commit:                       371b02d797528f175e9e6075aef6fc92757dfd52
configuration digest:         f011600fb1835dcdf9f6491f4b27613004e58e37a1cd5ef9b2b5697859ab40a6
bootstrap configuration digest: 9f9cd5ee1a388d0a50959f9fc68a2c2efecdb6e05ed7bdac1bfae9559d434e8d
runtime-input manifest:       22 files, each pinned by digest (TARGET_RUNTIME_INPUTS)
migrations:                   6 files, each pinned by digest (TARGET_MIGRATIONS)
protected files:              wrangler.jsonc, package.json, package-lock.json (TARGET_PROTECTED_FILES)
status:                       immutable, historical, independently reviewed
```

Generation 1's deployed Phase-1 bootstrap Worker version (`06dbca03-cf13-4e0a-b759-fcf2a9a15fb8`)
is bound to this exact generation via its activation annotation. **Generation 1's pinned digests are
never edited, for any reason — including to make tooling easier to maintain, to resolve a dependency
finding, or to "clean up" an incidental property of the files it pins.** If a historical generation's
files ever need to differ from what is pinned, that is not a generation-1 edit — it is a new
generation.

### Future generations

A new generation (Generation 2, 3, ...) is created only when an actual runtime change requires it —
never merely to resolve a tooling or dependency-hygiene finding in isolation. Creating one means:

1. Make the change on its own commit.
2. Independently review that commit as the new candidate target runtime — the same rigor Generation
   1 received, not a lighter pass because "only a dependency changed."
3. Only after that review accepts it, re-pin `src/target-runtime-manifest.js`'s
   `TARGET_WORKER_COMMIT`, `TARGET_CONFIGURATION_SHA256`, `TARGET_RUNTIME_INPUTS`,
   `TARGET_MIGRATIONS`, and `TARGET_PROTECTED_FILES` to the new generation's exact values.
4. Generation 1's own values are never overwritten by this — they remain in history (this document,
   prior commits, and any customer-generation mapping) as the exact facts of what Generation 1 was.

A new generation **starts from zero trust**: no finding, review, or acceptance from a prior
generation carries over. Every one of the facts in "The generation model" above must be established
again for the new generation on its own evidence.

### Mapping customer deployments to a generation

Each deployed Worker version's activation annotation already binds it to an exact
`reviewedCommit:configurationSha256` pair (see `docs/cloudflare-admin-v7.md`). As customer-facing
deployments are added, each one's current generation is this same pair, recorded alongside its
deployment record. A generation migration for an existing deployment is an explicit, authorized,
auditable operation (the same activation sequence this repository already uses), never a silent
consequence of a dependency or tooling change elsewhere in the repository.

### Roll-forward and rollback

Rolling a deployment forward to a new generation means running that generation's own reviewed
activation sequence against it. Rolling back means re-running an *earlier* generation's activation
sequence — which remains possible precisely because that earlier generation's pinned facts were
never rewritten. Neither operation ever edits a generation's own historical record; both only ever
change which generation a given deployment is currently activated to.

## Dependency-reproducibility policy (Part C)

This policy governs new verifier/tooling code and future generations. It does not apply
retroactively to Generation 1's own protected files (`package.json`, `package-lock.json`,
`wrangler.jsonc`) — see "Generation 1" above for why.

1. **No activation-critical dependency may use `"latest"`, `"*"`, or an unbounded range.** Pin an
   exact version. `tools/target-runtime-verifier/package.json` is the reference example: one
   dependency, one exact version, no range.
2. **No verifier, parser, compiler, bundler, Cloudflare SDK, or security-scanning tool may rely on an
   undeclared transitive dependency.** If code imports a package directly, that package is declared
   directly, in the package.json of whichever install actually provides it at resolution time — not
   assumed to be present because some other dependency happens to pull it in. This is exactly the
   defect issue #77 found and fixed: `es-module-lexer` was imported directly but only ever present
   as a transitive dependency of `vitest`.
3. **Lockfiles are committed** for every package.json in the repository, root and sub-package alike.
4. **CI installs only with `npm ci` (or equivalent deterministic installation), never
   `npm install`.** `npm install` re-resolves ranges against the registry and can silently rewrite
   the lockfile to a different version with no corresponding `package.json` diff to flag it in
   review; `npm ci` installs exactly what the lockfile already pins, every time. Enforced by
   `test/github-actions-runtime.test.js`.
5. **Node/npm version requirements are explicit** (`engines` in `package.json`; the Node major
   version pinned in each workflow's `setup-node` step).
6. **New generations pin exact versions for every build/test/deploy-critical dependency** —
   `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`,
   `typescript`, and any future addition — rather than carrying Generation 1's `"latest"` ranges
   forward unexamined.

## Known Generation-1 characteristic (not a defect to patch here)

Generation 1's root `package.json` pins six devDependencies to `"latest"`:
`@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`, `@types/node`, `typescript`,
`vitest`, `wrangler`. Per the dependency-reproducibility policy above, this would not be acceptable
for new tooling or a future generation — but it is a pinned, protected, historical property of
Generation 1, and editing `package.json` to change it would be exactly the kind of Generation-1
rewrite this document exists to prevent.

**Why this is not an active risk today:** every workflow installs with `npm ci` against the
committed `package-lock.json`, which already pins the exact resolved version each `"latest"` range
currently means — not a fresh resolution on every run. `test/github-actions-runtime.test.js` locks
this in.

**The latent risk this does not eliminate:** anyone who runs `npm install` instead of `npm ci`
locally, or who deliberately refreshes the lockfile (`npm update`, or installing a package
`@latest`), can silently move `wrangler`, `vitest`, or any of the other five to a materially
different, unreviewed version — with no corresponding change to `package.json` to flag it in
review, since `"latest"` reads the same before and after. This is tracked as a known characteristic
of Generation 1, to be resolved by pinning exact versions for these six dependencies as part of a
deliberate Generation 2, not by editing Generation 1's protected file.
