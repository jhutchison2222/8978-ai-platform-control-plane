import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BOOTSTRAP_VERIFIER_CONTRACT,
  BootstrapVerificationStop,
  assertActiveBootstrapDeployment,
  assertBootstrapAnnotation,
  assertExpectedBindings,
  assertMigrationTag,
  assertNoCustomDomains,
  assertServiceAuthSecretAbsent,
  assertSubdomainDisabled,
  createReadOnlyRequester,
  resolveImmutableWorkerId,
  selectActiveDeployment,
  verifyLocalProvenance,
} from "../scripts/verify-development-worker-bootstrap.js";
import { CLOUDFLARE_ADMIN_V7 } from "../src/cloudflare-admin-v7-contracts.js";
import { TARGET_WORKER_COMMIT } from "../src/target-runtime-manifest.js";

const source = await readFile("scripts/verify-development-worker-bootstrap.js", "utf8");
const WORKER_ID = "7d8fe11595134e5980a2c888a805ff03";

test("verifier is GET-only, writes no record, and never lists a zone-scoped route endpoint", () => {
  assert.deepEqual([...BOOTSTRAP_VERIFIER_CONTRACT.permittedMethods], ["GET"]);
  assert.equal(BOOTSTRAP_VERIFIER_CONTRACT.writesRecord, false);
  assert.equal(BOOTSTRAP_VERIFIER_CONTRACT.permittedEndpoints.length, 12);
  for (const endpoint of BOOTSTRAP_VERIFIER_CONTRACT.permittedEndpoints) {
    assert.ok(!endpoint.includes("/routes"), `${endpoint} must not enumerate zone-scoped routes`);
  }
  assert.ok(BOOTSTRAP_VERIFIER_CONTRACT.prohibitedEndpoints.some((e) => e.includes("/routes")));
  assert.ok(!/"(POST|PUT|PATCH|DELETE)"/u.test(source));
  assert.ok(!/writeFile|appendFile/u.test(source));
});

test("the requester issues GET without a body and rejects traversal", async () => {
  let observed;
  const requestGet = createReadOnlyRequester("x".repeat(40), async (url, init) => {
    observed = init;
    return { ok: true, status: 200, json: async () => ({ success: true, result: [] }) };
  });
  await requestGet("/accounts/x/workers/workers");
  assert.equal(observed.method, "GET");
  assert.equal(observed.body, undefined);
  await assert.rejects(() => requestGet("/accounts/../etc"), BootstrapVerificationStop);
});

test("immutable Worker ID resolves only on an exact single match validated against the stable script tag", () => {
  const workers = [{ name: "8978-ai-control-plane-dev", id: WORKER_ID }, { name: "other", id: "a".repeat(32) }];
  const scripts = [{ id: "8978-ai-control-plane-dev", tag: WORKER_ID }];
  assert.equal(resolveImmutableWorkerId(workers, scripts), WORKER_ID);

  // Ambiguous or missing matches fail.
  assert.throws(() => resolveImmutableWorkerId([], scripts), /missing or ambiguous/u);
  assert.throws(() => resolveImmutableWorkerId([workers[0], workers[0]], scripts), /missing or ambiguous/u);

  // A non-32-hex identifier fails: the legacy script endpoint returns the name as its id.
  assert.throws(
    () => resolveImmutableWorkerId([{ name: "8978-ai-control-plane-dev", id: "8978-ai-control-plane-dev" }], scripts),
    /32-character lowercase hexadecimal/u,
  );

  // Beta id and stable tag must agree.
  assert.throws(() => resolveImmutableWorkerId(workers, [{ id: "8978-ai-control-plane-dev", tag: "b".repeat(32) }]), /stable Worker script tag/u);
});

test("historical deployments never cause a false failure; only the active allocation is checked", () => {
  const history = [
    { id: "d3", is_active: true, versions: [{ version_id: "v3", percentage: 100 }] },
    { id: "d2", versions: [{ version_id: "v2", percentage: 100 }] },
    { id: "d1", versions: [{ version_id: "v1", percentage: 100 }] },
  ];
  const active = selectActiveDeployment(history);
  assert.equal(active.id, "d3");
  assert.deepEqual(assertActiveBootstrapDeployment(active, "v3"), { version_id: "v3", percentage: 100 });

  assert.throws(() => selectActiveDeployment([]), /No deployment exists/u);
  assert.throws(() => selectActiveDeployment([history[0], { id: "dX", active: true, versions: [] }]), /ambiguous/u);
});

test("an active deployment must allocate 100 percent to exactly one expected version", () => {
  assert.throws(() => assertActiveBootstrapDeployment({ versions: [] }), /exactly one version/u);
  assert.throws(() => assertActiveBootstrapDeployment({ versions: [{ version_id: "a", percentage: 100 }, { version_id: "b", percentage: 0 }] }), /exactly one version/u);
  assert.throws(() => assertActiveBootstrapDeployment({ versions: [{ version_id: "a", percentage: 50 }] }), /100 percent/u);
  assert.throws(() => assertActiveBootstrapDeployment({ versions: [{ version_id: "a", percentage: 100 }] }, "b"), /expected bootstrap version/u);
});

test("the bootstrap annotation must bind the exact target commit and bootstrap configuration digest", () => {
  const sha = CLOUDFLARE_ADMIN_V7.bootstrapConfigurationSha256;
  const good = { annotations: { "workers/message": `8978-bootstrap:${TARGET_WORKER_COMMIT}:${sha}` } };
  assert.equal(assertBootstrapAnnotation(good, { targetCommit: TARGET_WORKER_COMMIT, bootstrapConfigurationSha256: sha }), `8978-bootstrap:${TARGET_WORKER_COMMIT}:${sha}`);
  assert.throws(() => assertBootstrapAnnotation({ annotations: { "workers/message": `8978-reviewed:${TARGET_WORKER_COMMIT}:${sha}` } }, { targetCommit: TARGET_WORKER_COMMIT, bootstrapConfigurationSha256: sha }), /does not bind/u);
  assert.throws(() => assertBootstrapAnnotation({}, { targetCommit: TARGET_WORKER_COMMIT, bootstrapConfigurationSha256: sha }), /does not bind/u);
});

test("subdomain must be exactly disabled with previews disabled", () => {
  assert.deepEqual(assertSubdomainDisabled({ enabled: false, previews_enabled: false }), { enabled: false, previews_enabled: false });
  assert.throws(() => assertSubdomainDisabled({ enabled: true, previews_enabled: false }), /expected false\/false/u);
  assert.throws(() => assertSubdomainDisabled({ enabled: false, previews_enabled: true }), /expected false\/false/u);
  assert.throws(() => assertSubdomainDisabled(undefined), /expected false\/false/u);
});

test("migration tag must be exactly v2 before the reviewed version upload", () => {
  assert.equal(assertMigrationTag({ default_environment: { script: { migration_tag: "v2" } } }), "v2");
  assert.throws(() => assertMigrationTag({ default_environment: { script: { migration_tag: "v1" } } }), /expected exactly v2/u);
  assert.throws(() => assertMigrationTag({}), /expected exactly v2/u);
});

test("SERVICE_AUTH_KEYS_JSON must be absent by name and no Custom Domain may target the Worker", () => {
  assert.deepEqual(assertServiceAuthSecretAbsent([{ name: "OTHER" }]), ["OTHER"]);
  assert.throws(() => assertServiceAuthSecretAbsent([{ name: "SERVICE_AUTH_KEYS_JSON" }]), /already installed/u);
  assert.equal(assertNoCustomDomains([{ service: "another-worker", hostname: "x.example" }]), 0);
  assert.throws(() => assertNoCustomDomains([{ service: "8978-ai-control-plane-dev", hostname: "x.example" }]), /Custom Domain is attached/u);
});

test("the exact reviewed bindings are required", () => {
  const bindings = [
    { name: "AUTHORITY_DB", type: "d1", id: CLOUDFLARE_ADMIN_V7.d1Id },
    { name: "ORCHESTRATOR_QUEUE", type: "queue", queue_name: CLOUDFLARE_ADMIN_V7.queueName },
    { name: "ORCHESTRATOR_WORKFLOW", type: "workflow", workflow_name: CLOUDFLARE_ADMIN_V7.workflowName, class_name: CLOUDFLARE_ADMIN_V7.workflowClass },
    { name: "SERVICE_AUTH_REPLAY", type: "durable_object_namespace" },
    { name: "IDEMPOTENCY_STORE", type: "durable_object_namespace" },
    { name: "OWNER_DECISION_STORE", type: "durable_object_namespace" },
    { name: "AUDIT_STORE", type: "durable_object_namespace" },
  ];
  assert.equal(assertExpectedBindings(bindings), 7);
  assert.throws(() => assertExpectedBindings(bindings.slice(1)), /AUTHORITY_DB binding is missing/u);
  assert.throws(() => assertExpectedBindings(bindings.slice(0, 6)), /AUDIT_STORE binding is missing/u);
});

test("a remediation commit is required externally and HEAD must equal it", () => {
  assert.throws(() => verifyLocalProvenance(undefined), /supplied by the owner authorization/u);
  assert.throws(() => verifyLocalProvenance("not-a-sha"), /supplied by the owner authorization/u);
  assert.throws(() => verifyLocalProvenance("0".repeat(40)), /does not equal the externally authorized remediation commit/u);
});
