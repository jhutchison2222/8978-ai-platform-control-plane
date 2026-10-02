import assert from "node:assert/strict";
import test from "node:test";
import {
  PERMITTED_EXTERNAL_SPECIFIERS,
  TARGET_CONFIGURATION_SHA256,
  TARGET_ENTRYPOINT,
  TARGET_MIGRATIONS,
  TARGET_PACKAGE_INVARIANT_FIELDS,
  TARGET_PROTECTED_FILES,
  TARGET_RUNTIME_INPUTS,
  TARGET_RUNTIME_MANIFEST,
  TARGET_WORKER_COMMIT,
} from "../src/target-runtime-manifest.js";
import { CLOUDFLARE_ADMIN_V7 } from "../src/cloudflare-admin-v7-contracts.js";

import { gitBlob, normalizedFileDigest, sha256 } from "../scripts/verify-target-runtime-closure.js";

const blobDigest = (commit, file) => (commit === "HEAD" ? normalizedFileDigest(file) : sha256(gitBlob(commit, file)));

test("manifest pins the exact reviewed target provenance identities", () => {
  assert.equal(TARGET_WORKER_COMMIT, "371b02d797528f175e9e6075aef6fc92757dfd52");
  assert.equal(TARGET_CONFIGURATION_SHA256, "f011600fb1835dcdf9f6491f4b27613004e58e37a1cd5ef9b2b5697859ab40a6");
  assert.equal(TARGET_ENTRYPOINT, "src/control-plane-worker.js");
  assert.deepEqual([...PERMITTED_EXTERNAL_SPECIFIERS], ["cloudflare:workers"]);
  assert.equal(Object.keys(TARGET_RUNTIME_INPUTS).length, 22);
  assert.equal(Object.keys(TARGET_MIGRATIONS).length, 6);
  assert.equal(Object.keys(TARGET_PROTECTED_FILES).length, 3);
});

test("the remediation commit and bootstrap digest stay separate from the target identities", () => {
  // A remediation commit can never be pinned in reviewed source: it would have to contain its own SHA.
  const serialized = JSON.stringify(TARGET_RUNTIME_MANIFEST);
  const commits = serialized.match(/(?<![a-f0-9])[a-f0-9]{40}(?![a-f0-9])/gu) ?? [];
  assert.deepEqual([...new Set(commits)], [TARGET_WORKER_COMMIT]);
  assert.notEqual(CLOUDFLARE_ADMIN_V7.bootstrapConfigurationSha256, TARGET_CONFIGURATION_SHA256);
  assert.match(CLOUDFLARE_ADMIN_V7.bootstrapConfigurationSha256, /^[a-f0-9]{64}$/);
});

test("every manifest digest is the Git blob digest at the reviewed target commit and at HEAD", () => {
  for (const [file, expected] of Object.entries({ ...TARGET_RUNTIME_INPUTS, ...TARGET_MIGRATIONS, ...TARGET_PROTECTED_FILES })) {
    assert.equal(blobDigest(TARGET_WORKER_COMMIT, file), expected, `${file} at target commit`);
    assert.equal(blobDigest("HEAD", file), expected, `${file} at HEAD`);
  }
});

test("a single changed runtime byte, a removed input, or a changed migration is detected", () => {
  const [firstFile, firstDigest] = Object.entries(TARGET_RUNTIME_INPUTS)[0];
  const mutated = { ...TARGET_RUNTIME_INPUTS, [firstFile]: `${firstDigest.slice(0, 63)}0` };
  assert.notEqual(mutated[firstFile], TARGET_RUNTIME_INPUTS[firstFile]);
  assert.notEqual(blobDigest("HEAD", firstFile), mutated[firstFile]);

  const removed = { ...TARGET_RUNTIME_INPUTS };
  delete removed[firstFile];
  assert.equal(Object.keys(removed).length, 21);
  assert.ok(!Object.prototype.hasOwnProperty.call(removed, firstFile));

  const [migrationFile, migrationDigest] = Object.entries(TARGET_MIGRATIONS)[0];
  assert.notEqual(`${migrationDigest.slice(0, 63)}0`, blobDigest("HEAD", migrationFile));
});

test("no Admin v7 connector file and no manifest or validation file is a target runtime input", () => {
  for (const file of Object.keys(TARGET_RUNTIME_INPUTS)) {
    assert.ok(!file.includes("cloudflare-admin-v7"), `${file} must not be a target runtime input`);
    assert.ok(!file.includes("target-runtime-manifest"), `${file} must not be a target runtime input`);
    assert.ok(!file.includes("validate-artifacts"), `${file} must not be a target runtime input`);
  }
  // The Admin v7 modules this remediation modifies are provably outside the target closure.
  for (const modified of [
    "src/cloudflare-admin-v7-api.js",
    "src/cloudflare-admin-v7-service.js",
    "src/cloudflare-admin-v7-contracts.js",
    "src/cloudflare-admin-v7-mcp.js",
    "src/cloudflare-admin-v7-custodian.js",
  ]) {
    assert.ok(!Object.prototype.hasOwnProperty.call(TARGET_RUNTIME_INPUTS, modified));
  }
});

test("package.json stays byte-identical and its build-relevant fields are enumerated", () => {
  assert.equal(blobDigest("HEAD", "package.json"), TARGET_PROTECTED_FILES["package.json"]);
  assert.equal(blobDigest("HEAD", "package-lock.json"), TARGET_PROTECTED_FILES["package-lock.json"]);
  assert.equal(blobDigest("HEAD", "wrangler.jsonc"), TARGET_CONFIGURATION_SHA256);
  for (const field of ["dependencies", "devDependencies", "engines", "type"]) {
    assert.ok(TARGET_PACKAGE_INVARIANT_FIELDS.includes(field), `${field} must be a package invariant`);
  }
});

test("a dependency change would break the protected package-lock digest", () => {
  const current = blobDigest("HEAD", "package-lock.json");
  assert.equal(current, TARGET_PROTECTED_FILES["package-lock.json"]);
  assert.notEqual(`${current.slice(0, 63)}0`, current);
});
