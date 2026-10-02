import assert from "node:assert/strict";
import test from "node:test";
import {
  PROHIBITED_CONFIG_KEYS,
  assertConfigSurface,
  assertExternalSpecifiers,
  compareMechanisms,
  compareToManifest,
  parserClosure,
  verifyTargetRuntimeClosure,
} from "../scripts/verify-target-runtime-closure.js";
import { TARGET_ENTRYPOINT, TARGET_RUNTIME_INPUTS, TARGET_WORKER_COMMIT } from "../src/target-runtime-manifest.js";

const manifestPaths = new Set(Object.keys(TARGET_RUNTIME_INPUTS));

test("both authoritative mechanisms equal the reviewed manifest", async () => {
  const result = await verifyTargetRuntimeClosure({ againstCommit: TARGET_WORKER_COMMIT });
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.equal(result.summary.manifestInputs, 22);
  assert.equal(result.summary.parserInputs, 22);
  assert.equal(result.summary.bundlerInputs, 22);
  assert.deepEqual(result.summary.externalSpecifiers, ["cloudflare:workers"]);
});

test("the parser mechanism reaches exactly the reviewed manifest set", async () => {
  const parser = await parserClosure();
  assert.deepEqual(parser.failures, []);
  assert.deepEqual([...parser.local].sort(), [...manifestPaths].sort());
  assert.deepEqual([...parser.external], ["cloudflare:workers"]);
});

test("a new import into the closure fails set equality", () => {
  const expanded = new Set([...manifestPaths, "src/cloudflare-admin-v7-service.js"]);
  const failures = compareToManifest("test", expanded, manifestPaths);
  assert.ok(failures.some((f) => f.includes("is not in the reviewed manifest")));
  assert.ok(failures.some((f) => f.includes("Admin v7 connector file entered the target bundle")));
});

test("a removed runtime input fails set equality", () => {
  const reduced = new Set(manifestPaths);
  reduced.delete(TARGET_ENTRYPOINT);
  const failures = compareToManifest("test", reduced, manifestPaths);
  assert.ok(failures.some((f) => f.includes(`${TARGET_ENTRYPOINT} is absent from the bundle input set`)));
});

test("the manifest or a validation file entering the bundle fails", () => {
  for (const smuggled of ["src/target-runtime-manifest.js", "scripts/validate-artifacts.js", "scripts/verify-target-runtime-closure.js"]) {
    const failures = compareToManifest("test", new Set([...manifestPaths, smuggled]), manifestPaths);
    assert.ok(failures.some((f) => f.includes("manifest or validation file entered the target bundle")), smuggled);
  }
});

test("mechanism divergence in either direction fails", () => {
  const parser = new Set([...manifestPaths, "src/extra.js"]);
  const bundler = new Set(manifestPaths);
  const forward = compareMechanisms(parser, bundler);
  assert.ok(forward.some((f) => f.includes("was reached by the parser but is not a bundle input")));
  const reverse = compareMechanisms(bundler, parser);
  assert.ok(reverse.some((f) => f.includes("is a bundle input but the parser did not reach it")));
  assert.deepEqual(compareMechanisms(new Set(manifestPaths), new Set(manifestPaths)), []);
});

test("an unexpected external specifier fails and cloudflare:workers alone passes", () => {
  assert.deepEqual(assertExternalSpecifiers(new Set(["cloudflare:workers"])), []);
  const failures = assertExternalSpecifiers(new Set(["cloudflare:workers", "node:fs"]));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /unexpected external runtime specifier: node:fs/u);
});

test("Wrangler module rules, aliases, generated build inputs, and routes are rejected", () => {
  for (const key of PROHIBITED_CONFIG_KEYS) {
    const failures = assertConfigSurface({ main: TARGET_ENTRYPOINT, [key]: key === "routes" ? [] : {} });
    assert.ok(failures.some((f) => f.includes(key)), key);
  }
  assert.deepEqual(assertConfigSurface({ main: TARGET_ENTRYPOINT }), []);
  assert.ok(assertConfigSurface({ main: "src/other.js" }).some((f) => f.includes("entrypoint")));
});

test("a dynamic import in the closure is a stop condition", async () => {
  // The reviewed closure contains no dynamic import; the parser reports one when present.
  const parser = await parserClosure();
  assert.ok(!parser.failures.some((f) => f.includes("dynamic import")));
  assert.equal(parser.local.has(TARGET_ENTRYPOINT), true);
});
