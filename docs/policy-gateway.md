# Deterministic Policy Gateway

## Decision order

1. Validate the requested action's required fields, types, identifiers,
   environment, risk, cost, record count, and exception flags. Invalid requests
   are denied and do not create an owner approval request.
2. Canonicalize the executable intent and compute its SHA-256 digest. Review and
   test evidence bind to that digest and are stored separately.
3. Detect mandatory owner-exception conditions. Production and the enumerated
   owner-only boundaries never inherit development authorization.
4. Match only active, enabled, owner-approved, currently valid, versioned policies by exact environment,
   operation, resource kind, and resource identifier. Placeholder identifiers
   are intrinsically non-matching, and multiple matching policies are treated as
   an ambiguity that requires owner resolution.
5. Enforce policy risk, cost, and record-count limits.
6. Enforce required test evidence and independent maker/checker review bound to
   the same requested-action digest, plus a
   rollback plan. Missing validation does not request owner approval; it blocks
   execution until the normal gate is satisfied.
7. Return a gateway-issued, instance-bound standing-policy authorization
   containing the exact policy ID, policy version, action digest, and immutable
   evidence snapshot. The execution boundary recomputes the action digest and
   rejects copied, forged, cross-gateway, or mutated authorizations.

If no policy matches or a limit is exceeded, the gateway emits an
`owner_approval_request` and the executor remains blocked. An approved owner
exception is executable only after signature verification, expiry checking,
digest equality, and immediate pre-execution revalidation. The execution
boundary repeats all owner-decision checks; issuance alone is never sufficient.

## Evidence and audit

Every execution must persist the authorizing policy and version (or owner
decision), requested-action digest, proposing agent, independent reviewer when
required, resource and environment scope, before state, test evidence, result,
after state, rollback information, correlation ID, and idempotency key.

Approved policy-set versions are pinned to a canonical digest in the deployed
gateway code; runtime policy injection or in-place mutation fails closed.
Immediately before standing-policy execution, the gateway also re-evaluates the
policy's current validity and invokes a required trusted state/kill-switch hook.

These records are append-only audit inputs. The bootstrap requires an
idempotency registry and includes an in-memory implementation only for tests;
the deployment must provide a durable atomic implementation. Storage must also
add tamper evidence, retention, access controls, and before/after payload size
handling before deployment.

## Development-only boundary

The bootstrap policy set contains no production environment. Exact identifiers
are enabled only for the control-plane repository and the two named development
Workers. D1, R2, Queue, Workflow, GHL sandbox, and ai-employees.net test policies
remain disabled until owner-approved identifiers replace the placeholders in a
new policy version.

The ai-employees.net integration boundary follows the platform guide retrieved
on 2026-08-11: credentials belong in headers, assistant-collected parameters do
not carry secrets, and platform system variables are resolved by the platform.
This bootstrap does not create, modify, call, message, or activate any
ai-employees.net resource.

## Rollback and containment

- Revoke or disable a policy version to prevent new authorizations.
- Use correlation and idempotency identifiers to locate the exact execution.
- Apply the action-specific rollback plan and persist its result.
- Invoke the environment kill switch when rollback cannot restore state.
- Never broaden a development policy as a shortcut for an exception.

## First development deployment gate

Before the first deployment, the owner must supply and approve the exact
Cloudflare account/resource identifiers and bindings for the target development
Worker plus its D1, R2, Queue, and Workflow dependencies. The implementation
must then add the Worker entrypoint, durable audit storage, signature-key
verification, kill-switch configuration, deployment/rollback scripts, and
integration tests against those approved development resources. A checker must
review the resulting policy version and deployment evidence. Production remains
out of scope.
