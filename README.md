# 8978 AI Platform Control Plane

Development bootstrap for the deterministic policy and execution gateway used by the 8978 AI communications platform.

The gateway is built around trusted runtime construction. Models request intent; injected authoritative adapters resolve the provider/account/resource/environment and supply authenticated identities, limits, test evidence, executable rollback evidence, Project Knowledge, idempotency, audit, Queue, and Workflow services. Any missing or ambiguous security dependency fails closed.

Only the control-plane GitHub repository policy is enabled. Cloudflare, GHL, and ai-employees.net policies remain disabled until every required account and runtime identifier is authoritatively resolved. Production is not authorized.

Security properties and unresolved identifiers are documented in [docs/policy-gateway.md](docs/policy-gateway.md). Validate with:

```bash
npm test
npm run check
npm run secret-scan
```
