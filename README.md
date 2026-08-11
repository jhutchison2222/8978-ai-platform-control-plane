# 8978 AI Platform Control Plane

Development bootstrap for the deterministic policy and execution gateway used by
the 8978 AI communications platform.

## Authorization model

The gateway evaluates every requested action against versioned, owner-approved
standing policies. A matching development policy may authorize autonomous
execution only after its resource, environment, operation, risk, cost,
record-count, test, independent-review, and rollback limits are satisfied.

Owner approval is an exception path. The gateway creates a digest-bound
`owner_approval_request` only when no active policy matches, a policy limit is
exceeded, or the action is production-sensitive, destructive to production or
customer data, expands credential scope, enables a new production external-write
integration, changes a FINAL decision, exceeds a financial/resource threshold,
or requires a legal/privacy/compliance/contractual decision.

The executor fails closed unless it receives either a standing-policy
authorization or a valid signed owner exception decision bound to the exact
requested-action digest.

## Development policy bootstrap

[`policies/development-standing-policies.json`](policies/development-standing-policies.json)
contains explicit development-only policies for:

- `jhutchison2222/8978-ai-platform-control-plane`
- `8978-ai-orchestrator-dev`
- `project-knowledge-worker-dev`
- development D1, R2, Queues, and Workflows
- the designated GHL sandbox
- the ai-employees.net test environment

Only the repository and two named development Workers are enabled initially.
Resources whose approved identifiers are not available are disabled fail-closed
placeholders. Replacing a placeholder and enabling its policy requires an
owner-approved policy version; placeholder strings can never match an action.

No policy authorizes production.

## Validate

```bash
npm test
npm run check
```

See [`docs/policy-gateway.md`](docs/policy-gateway.md) for the decision flow,
execution evidence contract, exception handling, and first-deployment gate.
