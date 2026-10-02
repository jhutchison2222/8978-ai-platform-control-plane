# Development Activation Single-Clock Verification

Status: DEVELOPMENT FOUNDATION ONLY — UNWIRED, UNBOUND, AND NOT DEPLOYED

PR #21 removes split-clock ambiguity from the activation-evidence verification path. It does not create evidence, add a migration, install a key or secret, add a route or binding, change the activation plan or preflight contract, authorize activation, or deploy anything.

## Exact temporal boundary

`AuthenticatedDevelopmentActivationEvidenceVerifier.verify()` now accepts an optional `{ now }` value. When omitted it invokes its constructor-injected clock exactly once. The resulting value must be a valid `Date` with a safe integer timestamp before the bundle provider or any signature verifier is called.

That exact validated `Date` object is passed to:

- the activation-evidence bundle provider;
- all four maker/checker identity-verification calls; and
- both owner-decision verification calls.

`AuthenticatedDevelopmentActivationEvidenceChainVerifier` already validates one chain time for the authenticated-write receipt. PR #21 now passes that same object to the evidence verifier as well, so bundle validity, six public-key checks, and write-receipt validity share one temporal decision point. Missing, malformed, or invalid time values fail closed before acceptance.

## Trust and safety boundary

This change does not add a clock source, use wall time after the single capture, read or write D1 itself, authenticate HMAC requests, consume nonces, or alter any digest or principal rule. Existing verifiers retain their reviewed responsibilities.

The changed modules contain no new SQL, external `fetch`, OAuth dependency, secret, private key, process/filesystem action, Wrangler invocation, Queue/Workflow operation, provider mutation, or deployment path. They remain absent from the Worker, development runtime, and activation preflight.

Workers-pool tests use real migrated local D1 and real Ed25519 verification to prove reference equality across the provider, four identity checks, and two owner checks. The real PR #18 writer interoperability test proves the same chain remains valid end to end. No remote D1 or Cloudflare resource is touched.
