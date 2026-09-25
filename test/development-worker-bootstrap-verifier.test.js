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
  listAllWorkers,
  parseVerifierArguments,
  requireBootstrapVersionId,
  resolveImmutableWorkerId,
  runBootstrapVerification,
  selectActiveDeployment,
  verifyLocalProvenance,
} from "../scripts/verify-development-worker-bootstrap.js";
import { CLOUDFLARE_ADMIN_V7 } from "../src/cloudflare-admin-v7-contracts.js";
import { TARGET_WORKER_COMMIT } from "../src/target-runtime-manifest.js";

const source = await readFile("scripts/verify-development-worker-bootstrap.js", "utf8");
const WORKER_ID = "7d8fe11595134e5980a2c888a805ff03";
const VERSION_ID = "0f1e2d3c-4b5a-4968-8776-65544332211a";
const REMEDIATION = "a".repeat(40);

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
  assert.equal(active.versions[0].version_id, "v3");
  const current = selectActiveDeployment([{ ...history[0], versions: [{ version_id: VERSION_ID, percentage: 100 }] }, ...history.slice(1)]);
  assert.deepEqual(assertActiveBootstrapDeployment(current, VERSION_ID), { version_id: VERSION_ID, percentage: 100 });

  assert.throws(() => selectActiveDeployment([]), /No deployment exists/u);
  assert.throws(() => selectActiveDeployment([history[0], { id: "dX", active: true, versions: [] }]), /ambiguous/u);
});

test("an active deployment must allocate 100 percent to exactly one expected version", () => {
  assert.throws(() => assertActiveBootstrapDeployment({ versions: [] }), /exactly one version/u);
  assert.throws(() => assertActiveBootstrapDeployment({ versions: [{ version_id: "a", percentage: 100 }, { version_id: "b", percentage: 0 }] }), /exactly one version/u);
  assert.throws(() => assertActiveBootstrapDeployment({ versions: [{ version_id: "a", percentage: 50 }] }), /100 percent/u);
  assert.throws(() => assertActiveBootstrapDeployment({ versions: [{ version_id: "a", percentage: 100 }] }, VERSION_ID), /expected bootstrap version/u);
  // An expected version ID is mandatory and must be well-formed; absence can never skip the comparison.
  assert.throws(() => assertActiveBootstrapDeployment({ versions: [{ version_id: VERSION_ID, percentage: 100 }] }), /--bootstrap-version-id must be/u);
  assert.throws(() => assertActiveBootstrapDeployment({ versions: [{ version_id: "b", percentage: 100 }] }, "b"), /--bootstrap-version-id must be/u);
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

// ------------------------------------------------ B4: bootstrap version ID input ---

test("the verifier requires --bootstrap-version-id and never reads another argv position", () => {
  assert.throws(() => parseVerifierArguments(["--remediation-commit", REMEDIATION]), /--bootstrap-version-id is required/u);
  assert.throws(() => parseVerifierArguments([]), /is required/u);
  // The historical defect: an absent flag made indexOf return -1, so argv[0] was read as the version.
  assert.throws(() => parseVerifierArguments(["C:/node.exe", "--remediation-commit", REMEDIATION]), /Unrecognized verifier argument/u);
  assert.ok(!/process\.argv\[process\.argv\.indexOf/u.test(source));
  assert.ok(source.includes("parseVerifierArguments(process.argv.slice(2))"));
});

test("a flag without a value is refused", () => {
  assert.throws(() => parseVerifierArguments(["--remediation-commit", REMEDIATION, "--bootstrap-version-id"]), /--bootstrap-version-id requires a value/u);
  assert.throws(() => parseVerifierArguments(["--bootstrap-version-id", "--remediation-commit", REMEDIATION]), /--bootstrap-version-id requires a value/u);
  assert.throws(() => parseVerifierArguments(["--remediation-commit", "", "--bootstrap-version-id", VERSION_ID]), /--remediation-commit requires a value/u);
});

test("a malformed, placeholder, or repeated bootstrap version ID is refused", () => {
  for (const bad of ["<BOOTSTRAP_VERSION_ID>", "not-a-uuid", VERSION_ID.toUpperCase(), VERSION_ID.replace(/-/gu, ""), `${VERSION_ID}0`, ` ${VERSION_ID}`]) {
    assert.throws(() => parseVerifierArguments(["--remediation-commit", REMEDIATION, "--bootstrap-version-id", bad]), /--bootstrap-version-id must be/u, bad);
  }
  assert.throws(
    () => parseVerifierArguments(["--remediation-commit", REMEDIATION, "--bootstrap-version-id", VERSION_ID, "--bootstrap-version-id", VERSION_ID]),
    /supplied more than once/u,
  );
  assert.throws(() => parseVerifierArguments(["--remediation-commit", "<AUTHORIZED_REMEDIATION_SHA>", "--bootstrap-version-id", VERSION_ID]), /40-character lowercase/u);
  assert.throws(() => requireBootstrapVersionId(undefined), /--bootstrap-version-id must be/u);
});

test("a valid version ID and remediation commit parse exactly, in either order", () => {
  const expected = { remediationCommit: REMEDIATION, bootstrapVersionId: VERSION_ID };
  assert.deepEqual(parseVerifierArguments(["--remediation-commit", REMEDIATION, "--bootstrap-version-id", VERSION_ID]), expected);
  assert.deepEqual(parseVerifierArguments(["--bootstrap-version-id", VERSION_ID, "--remediation-commit", REMEDIATION]), expected);
});

test("missing or malformed version input stops before any request or provenance conclusion", async () => {
  let requests = 0;
  const requestGet = async () => { requests += 1; return {}; };
  for (const expectedBootstrapVersionId of [undefined, "", "node", "<BOOTSTRAP_VERSION_ID>"]) {
    await assert.rejects(() => runBootstrapVerification({ requestGet, remediationCommit: REMEDIATION, expectedBootstrapVersionId }), /--bootstrap-version-id must be/u);
  }
  assert.equal(requests, 0);
});

test("the pinned verification command parses once its runtime placeholders are supplied", async () => {
  const packet = JSON.parse(await readFile("deployment/development-worker-bootstrap-creation-packet.json", "utf8"));
  const command = packet.authorizedCommands.bootstrapVerification
    .replace("<AUTHORIZED_REMEDIATION_SHA>", REMEDIATION)
    .replace("<BOOTSTRAP_VERSION_ID>", VERSION_ID);
  const [node, script, ...args] = command.split(" ");
  assert.equal(node, "node");
  assert.equal(script, "scripts/verify-development-worker-bootstrap.js");
  assert.deepEqual(parseVerifierArguments(args), { remediationCommit: REMEDIATION, bootstrapVersionId: VERSION_ID });
  // Unsubstituted placeholders are refused rather than treated as values.
  assert.throws(() => parseVerifierArguments(packet.authorizedCommands.bootstrapVerification.split(" ").slice(2)), /40-character lowercase/u);
});

// ------------------------------------------------------ B2: Worker pagination ---

const page = (result, info) => ({ success: true, result, result_info: info });

function pagedRequester(pages) {
  const paths = [];
  const requestGet = async (path, options = {}) => {
    paths.push(path);
    assert.equal(options.envelope, true, "the Worker listing must read the full envelope including result_info");
    const number = Number(new URL(`https://x${path}`).searchParams.get("page"));
    const body = pages[number - 1];
    if (body === undefined) throw new Error(`unexpected page ${number}`);
    return body;
  };
  return { requestGet, paths };
}

test("the verifier enumerates every Worker page with page/per_page and no cursor", async () => {
  const filler = Array.from({ length: 100 }, (_, index) => ({ id: index.toString(16).padStart(32, "0"), name: `worker-${index}` }));
  const { requestGet, paths } = pagedRequester([
    page(filler, { page: 1, per_page: 100, count: 100, total_pages: 2, total_count: 101 }),
    page([{ id: WORKER_ID, name: "8978-ai-control-plane-dev" }], { page: 2, per_page: 100, count: 1, total_pages: 2, total_count: 101 }),
  ]);
  const workers = await listAllWorkers(requestGet);
  assert.equal(workers.length, 101);
  assert.deepEqual(paths, [
    `/accounts/${CLOUDFLARE_ADMIN_V7.accountId}/workers/workers?page=1&per_page=100`,
    `/accounts/${CLOUDFLARE_ADMIN_V7.accountId}/workers/workers?page=2&per_page=100`,
  ]);
  // The target on the second page is found, and the stable-tag cross-check still applies.
  assert.equal(resolveImmutableWorkerId(workers, [{ id: "8978-ai-control-plane-dev", tag: WORKER_ID }]), WORKER_ID);
  assert.ok(!/cursor=|result_info\??\.cursor/u.test(source));
});

test("the verifier's Worker listing fails closed on malformed pagination", async () => {
  const w = (id) => ({ id, name: id.slice(0, 6) });
  for (const [pages, pattern] of [
    [[{ success: true, result: [w("a".repeat(32))] }], /pagination metadata/u],
    [[page([w("a".repeat(32))], { page: 1, per_page: 1, total_pages: 2, total_count: 2 }), page([w("a".repeat(32))], { page: 2, per_page: 1, total_pages: 2, total_count: 2 })], /more than once/u],
    [[page([w("a".repeat(32))], { page: 1, per_page: 2, total_pages: 2, total_count: 3 }), page([w("b".repeat(32))], { page: 2, per_page: 2, total_pages: 2, total_count: 3 })], /truncated before the final page/u],
    [[page([w("a".repeat(32))], { page: 1, per_page: 1, total_pages: 1, total_count: 2 })], /total_count is 2/u],
    [[page([w("a".repeat(32))], { page: 1, per_page: 1, total_pages: "1", total_count: 1 })], /invalid total_pages/u],
  ]) {
    const { requestGet } = pagedRequester(pages);
    await assert.rejects(() => listAllWorkers(requestGet), (error) => error instanceof BootstrapVerificationStop && pattern.test(error.message));
  }
});

test("the read-only requester can return the full envelope for pagination without changing its GET-only shape", async () => {
  const body = { success: true, result: [], result_info: { page: 1, per_page: 100, total_pages: 0, total_count: 0 } };
  const requestGet = createReadOnlyRequester("x".repeat(40), async (url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    return { ok: true, status: 200, json: async () => body };
  });
  assert.deepEqual(await requestGet("/accounts/x/workers/workers?page=1&per_page=100", { envelope: true }), body);
  assert.deepEqual(await requestGet("/accounts/x/workers/workers?page=1&per_page=100"), []);
});
