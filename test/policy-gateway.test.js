import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalize, digestCanonicalValue, parseJsonStrict } from "../src/canonical-digest.js";
import { PolicyGateway, selectUniquePolicyMatch } from "../src/policy-gateway.js";
import { assertCustomerIsolation, validateResolvedResource } from "../src/resource-contract.js";
import { validateRuntimeReadiness, assertOrchestratorEnvelope, assertProjectKnowledgeRecord } from "../src/runtime-contracts.js";
import { executeAuthorizedAction } from "../src/execution-record.js";
import { DurableAppendOnlyAuditStore, DurableLeaseStore, DurableOwnerDecisionStore } from "../src/test-runtime-stores.js";

const policySet = JSON.parse(await readFile("policies/development-standing-policies.json", "utf8"));
const repository = Object.freeze({ kind: "github_repository", provider: "github", repository: "jhutchison2222/8978-ai-platform-control-plane", environment: "development", isolation: { mode: "internal_8978" } });

function action(overrides = {}) {
  return { actionId: "action-1", operation: "write_code", requestedTarget: { locator: "control-plane" }, correlationId: "corr-1", idempotencyKey: "idem-1", rollbackRef: "rollback-ok",
    evidence: { makerAttestation: "maker-signed", checkerAttestation: "checker-signed" }, productionSensitive: false,
    destructiveProductionOrCustomerData: false, credentialScopeExpansion: false, newProductionExternalWriteIntegration: false,
    finalOwnerDecisionChange: false, legalPrivacyComplianceContractualDecision: false, payload: { files: ["src/a.js"] }, ...overrides };
}

function runtime(overrides = {}) {
  return {
    resourceResolver: { async resolve(hint) { if (hint.locator === "unavailable") throw new Error("offline"); if (hint.locator === "production") return { kind: "cloudflare_worker", provider: "cloudflare", accountId: "acct", workerName: "customer-worker", environment: "production", isolation: { mode: "dedicated_customer", customerId: "customer-1" }, bindings: { customerId: "customer-1", dedicatedWorkerName: "customer-worker", dedicatedD1DatabaseId: "d1-customer-1", sharedProductionD1: false } }; return repository; } },
    identityVerifier: { async verify(attestation, { role, actionDigest }) { if (attestation === "maker-signed" && role === "maker") return { principalId: "maker-principal", actionDigest }; if (attestation === "checker-signed" && role === "checker") return { principalId: "checker-principal", actionDigest }; if (attestation === "maker-alias" && role === "checker") return { principalId: "maker-principal", actionDigest }; throw new Error("unauthenticated"); } },
    evidenceProvider: { async getTestEvidence(actionDigest, required) { return required.map((testId) => ({ testId, result: "passed", actionDigest, issuedAt: "2000-01-01T00:00:00Z", expiresAt: "2100-01-01T00:00:00Z", evidenceDigest: "sha256:" + "a".repeat(64) })); } },
    rollbackVerifier: { async verify(reference, { actionDigest }) { return reference === "rollback-ok" ? { valid: true, executable: true, actionDigest, issuedAt: "2000-01-01T00:00:00Z", expiresAt: "2100-01-01T00:00:00Z", evidenceDigest: "sha256:" + "b".repeat(64) } : { valid: false }; } },
    limitProvider: { async resolve(_action, _resolved, { actionDigest }) { return { risk: "medium", costUsd: 0, recordCount: 1, actionDigest, evidenceDigest: "sha256:" + "c".repeat(64) }; } },
    ownerVerifier: { async verify(decision) { return decision.signature === "valid"; } }, ownerDecisionStore: new DurableOwnerDecisionStore(),
    idempotencyStore: new DurableLeaseStore(), auditStore: new DurableAppendOnlyAuditStore(),
    revalidateStandingState: async () => true,
    projectKnowledge: { async readGoverningKnowledge({ actionDigest }) { return { recordId: "pk-1", status: "CURRENT", version: "1", scope: "control-plane", knowledge: { rule: "test-only" }, digest: "sha256:" + "d".repeat(64), retrievedAt: "2026-08-11T19:00:00Z", actionDigest }; } },
    workflowDispatcher: { async dispatch() { return { accepted: true }; } }, queuePublisher: { async publish() { return { accepted: true }; } }, ...overrides,
  };
}

test("1: multiple policy matches fail closed before divergent limits are evaluated", () => {
  const selected = selectUniquePolicyMatch([{ id: "wide", limits: { recordCount: 100 } }, { id: "narrow", limits: { recordCount: 0 } }]);
  assert.deepEqual(selected, { selected: null, reason: "ambiguous_standing_policy_match" });
});

test("2: authoritative resolver controls provider, account, resource, and environment", async () => {
  const gateway = await PolicyGateway.create(policySet, runtime());
  const forged = action({ requestedTarget: { locator: "control-plane", provider: "cloudflare", environment: "production" } });
  const result = await gateway.evaluate(forged);
  assert.equal(result.outcome, "authorized_by_standing_policy");
  assert.equal(result.resolvedTarget.provider, "github");
  const unavailable = await gateway.evaluate(action({ requestedTarget: { locator: "unavailable" } }));
  assert.deepEqual(unavailable, { outcome: "denied", reason: "authoritative_resolution_unavailable", details: undefined });
});

test("3: maker and checker require authenticated distinct principals", async () => {
  const gateway = await PolicyGateway.create(policySet, runtime());
  const forged = await gateway.evaluate(action({ evidence: { makerAttestation: "maker-signed", checkerAttestation: "forged" } }));
  assert.equal(forged.outcome, "validation_required");
  const alias = await gateway.evaluate(action({ evidence: { makerAttestation: "maker-signed", checkerAttestation: "maker-alias" } }));
  assert.ok(alias.unmetGates.some((gate) => gate.reason === "independent_authenticated_principals_required"));
});

test("4: trusted limits, tests, and executable rollback fail closed when unavailable or fabricated", async () => {
  const noLimits = await PolicyGateway.create(policySet, runtime({ limitProvider: { async resolve() { throw new Error("offline"); } } }));
  assert.equal((await noLimits.evaluate(action())).reason, "trusted_limits_unavailable");
  const fakeTests = await PolicyGateway.create(policySet, runtime({ evidenceProvider: { async getTestEvidence(digest, required) { return required.map((testId) => ({ testId, result: "passed", actionDigest: digest, evidenceDigest: "model-supplied" })); } } }));
  assert.equal((await fakeTests.evaluate(action())).outcome, "validation_required");
  const noRollback = await PolicyGateway.create(policySet, runtime({ rollbackVerifier: { async verify() { return { valid: true, executable: false }; } } }));
  assert.equal((await noRollback.evaluate(action())).outcome, "validation_required");
});

test("5: owner verifier is construction-only and decisions are single-use", async () => {
  const gateway = await PolicyGateway.create(policySet, runtime());
  const requested = action({ operation: "delete_repository" });
  const request = await gateway.evaluate(requested);
  assert.equal(request.outcome, "owner_approval_required");
  const decision = { decisionId: "decision-1", requestedActionDigest: request.actionDigest, decision: "approved", decidedBy: "owner", decidedAt: "2026-08-11T18:00:00Z", expiresAt: "2026-08-12T18:00:00Z", issuerKeyId: "owner-key", signatureAlgorithm: "Ed25519", signature: "valid" };
  const authorization = await gateway.authorizeOwnerException(requested, decision, { now: new Date("2026-08-11T19:00:00Z"), verifySignature: async () => true });
  assert.equal(authorization.outcome, "authorized_by_owner_exception");
  await gateway.assertExecutable(requested, authorization, { now: new Date("2026-08-11T19:01:00Z") });
  await assert.rejects(() => gateway.assertExecutable(requested, authorization, { now: new Date("2026-08-11T19:02:00Z") }), /replay/);
  const concurrentDecision = { ...decision, decisionId: "decision-concurrent" };
  const concurrentAuthorization = await gateway.authorizeOwnerException(requested, concurrentDecision, { now: new Date("2026-08-11T19:00:00Z") });
  const concurrent = await Promise.allSettled([gateway.assertExecutable(requested, concurrentAuthorization, { now: new Date("2026-08-11T19:03:00Z") }), gateway.assertExecutable(requested, concurrentAuthorization, { now: new Date("2026-08-11T19:03:00Z") })]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  const bad = await gateway.authorizeOwnerException(requested, { ...decision, decisionId: "decision-2", signature: "forged" }, { now: new Date("2026-08-11T19:00:00Z") });
  assert.equal(bad.reason, "invalid_owner_signature");
});

test("6: awaited atomic idempotency leases block concurrency and allow expiry recovery", async () => {
  const store = new DurableLeaseStore(); const now = new Date("2026-08-11T19:00:00Z");
  const first = await store.reserve({ scope: "scope", actionDigest: "d", leaseMs: 1000, now });
  assert.equal((await store.reserve({ scope: "scope", actionDigest: "d", leaseMs: 1000, now })).reserved, false);
  const recovered = await store.reserve({ scope: "scope", actionDigest: "d", leaseMs: 1000, now: new Date(now.valueOf() + 1001) });
  assert.equal(recovered.recovered, true);
  assert.equal((await store.complete({ scope: "scope", leaseId: first.leaseId, resultDigest: "x" })).completed, false);
  assert.equal((await store.complete({ scope: "scope", leaseId: recovered.leaseId, resultDigest: "x" })).completed, true);
});

test("7: durable append-only audit is verified before effects and hash chains events", async () => {
  const rt = runtime(); const gateway = await PolicyGateway.create(policySet, rt); const requested = action(); const authorization = await gateway.evaluate(requested);
  let effects = 0;
  const executed = await executeAuthorizedAction({ action: requested, authorization, gateway, runtime: rt, execute: async () => { effects += 1; return { ok: true }; }, rollback: async () => ({ status: "not_needed" }), now: new Date("2026-08-11T19:00:00Z") });
  assert.equal(effects, 1); assert.equal(rt.auditStore.events().length, 2);
  assert.equal(rt.auditStore.events()[1].receipt.previousDigest, rt.auditStore.events()[0].receipt.eventDigest);
  assert.equal(await rt.auditStore.verifyReceipt(executed.intentReceipt, { tampered: true }), false);
  const concurrentStore = new DurableAppendOnlyAuditStore();
  const concurrentReceipts = await Promise.all([concurrentStore.append({ event: 1 }), concurrentStore.append({ event: 2 })]);
  assert.deepEqual(concurrentReceipts.map((receipt) => receipt.sequence), [1, 2]);
  assert.equal(concurrentReceipts[1].previousDigest, concurrentReceipts[0].eventDigest);
  const rtFail = runtime(); rtFail.auditStore.failNext = true; const gFail = await PolicyGateway.create(policySet, rtFail); const authFail = await gFail.evaluate(action());
  await assert.rejects(() => executeAuthorizedAction({ action: action(), authorization: authFail, gateway: gFail, runtime: rtFail, execute: async () => { effects += 1; }, rollback: async () => ({}) }), /audit unavailable/);
  assert.equal(effects, 1);
});

test("8: RFC 8785 canonicalization is stable and rejects non-I-JSON", async () => {
  assert.equal(canonicalize({ b: 1, a: [3, { z: "x", y: true }], n: -0 }), '{"a":[3,{"y":true,"z":"x"}],"b":1,"n":0}');
  assert.equal(await digestCanonicalValue({ a: 1, b: 2 }), await digestCanonicalValue({ b: 2, a: 1 }));
  for (const value of [{ x: undefined }, { x: NaN }, { x: Infinity }, [, 1], { x: "\ud800" }, { x: 1n }]) assert.throws(() => canonicalize(value));
  assert.throws(() => parseJsonStrict('{"a":1,"a":2}'), /Duplicate/);
});

test("9: discriminated resources enforce provider fields and production customer isolation", () => {
  assert.deepEqual(validateResolvedResource(repository), []);
  assert.ok(validateResolvedResource({ ...repository, provider: "cloudflare" }).includes("provider_kind_mismatch"));
  const prod = { kind: "cloudflare_d1", provider: "cloudflare", accountId: "acct", databaseId: "d1", databaseName: "customer-d1", environment: "production", isolation: { mode: "dedicated_customer", customerId: "c1" } };
  assert.ok(assertCustomerIsolation(prod, { customerId: "c2", dedicatedWorkerName: "w", dedicatedD1DatabaseId: "d1", sharedProductionD1: false }).includes("customer_binding_mismatch"));
  assert.ok(assertCustomerIsolation(prod, { customerId: "c1", dedicatedWorkerName: "w", dedicatedD1DatabaseId: "d1", sharedProductionD1: true }).includes("shared_production_d1_prohibited"));
});

test("10: runtime readiness, Project Knowledge, Workflow, and Queue contracts fail closed", async () => {
  const incomplete = validateRuntimeReadiness({}); assert.equal(incomplete.ready, false); assert.ok(incomplete.missing.includes("projectKnowledge"));
  await assert.rejects(() => PolicyGateway.create(policySet, {}), /Runtime is not ready/);
  const noPk = await PolicyGateway.create(policySet, runtime({ projectKnowledge: { async readGoverningKnowledge() { throw new Error("not attached"); } } }));
  assert.equal((await noPk.evaluate(action())).reason, "governing_project_knowledge_unavailable");
  assert.throws(() => assertProjectKnowledgeRecord({ status: "PROPOSED" }), /unavailable/);
  assert.throws(() => assertProjectKnowledgeRecord({ recordId:"pk",status:"CURRENT",version:"1",scope:"control-plane",knowledge:{nested:{api_key:"forbidden"}},digest:"sha256:"+"d".repeat(64),retrievedAt:"2026-08-11T19:00:00Z",actionDigest:"sha256:"+"a".repeat(64) }), /credentials/);
  assert.throws(() => assertOrchestratorEnvelope({ messageId: "m" }), /fields/);
  const envelope = { messageId: "m", actionDigest: "sha256:" + "e".repeat(64), correlationId: "c", idempotencyKey: "i", workflowName: "wf", queueName: "q",
    projectKnowledgeRef: { recordId: "pk", status: "FINAL", version: "1", digest: "sha256:" + "f".repeat(64) } };
  assert.equal(assertOrchestratorEnvelope(envelope), true);
});

test("standing authorization revalidates trusted evidence and kill-switch state", async () => {
  let available = true; const rt = runtime({ evidenceProvider: { async getTestEvidence(digest, required) { if (!available) throw new Error("offline"); return required.map((testId) => ({ testId, result: "passed", actionDigest: digest, issuedAt: "2000-01-01T00:00:00Z", expiresAt: "2100-01-01T00:00:00Z", evidenceDigest: "sha256:" + "f".repeat(64) })); } } });
  const gateway = await PolicyGateway.create(policySet, rt); const requested = action(); const authorization = await gateway.evaluate(requested); available = false;
  await assert.rejects(() => gateway.assertExecutable(requested, authorization), /stale/);
});
