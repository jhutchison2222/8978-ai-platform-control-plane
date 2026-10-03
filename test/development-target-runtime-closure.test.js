import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  PROHIBITED_CONFIG_KEYS,
  assertConfigSurface,
  assertExternalSpecifiers,
  compareMechanisms,
  compareToManifest,
  parserClosure,
  repoRoot,
  verifyTargetRuntimeClosure,
} from "../scripts/verify-target-runtime-closure.js";
import { TARGET_ENTRYPOINT, TARGET_RUNTIME_INPUTS, TARGET_WORKER_COMMIT } from "../src/target-runtime-manifest.js";

const verifierSubpackage = path.join(repoRoot, "tools", "target-runtime-verifier");

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

test("a verifier-tooling file entering the bundle fails", () => {
  const failures = compareToManifest("test", new Set([...manifestPaths, "tools/target-runtime-verifier/parser.mjs"]), manifestPaths);
  assert.ok(failures.some((f) => f.includes("verifier tooling file entered the target bundle")));
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

// --------------------------- tools/target-runtime-verifier isolation (issue #77) ---

test("the parser mechanism resolves es-module-lexer from its own isolated sub-package, not the repository root", () => {
  const resolved = execFileSync(process.execPath, [path.join(verifierSubpackage, "parser.mjs"), "--resolve-path"], {
    cwd: verifierSubpackage,
    encoding: "utf8",
  }).trim();
  const subpackageNodeModules = path.join(verifierSubpackage, "node_modules", "es-module-lexer").split(path.sep).join("/");
  const rootNodeModules = path.join(repoRoot, "node_modules", "es-module-lexer").split(path.sep).join("/");
  assert.ok(resolved.includes(subpackageNodeModules), `resolved path must be inside the sub-package: ${resolved}`);
  assert.ok(!resolved.startsWith(`file://${rootNodeModules}`), `resolved path must not be the repository root's hoisted copy: ${resolved}`);
});

test("the verifier sub-package pins an exact, non-range es-module-lexer version and commits its own lockfile", () => {
  const manifest = JSON.parse(readFileSync(path.join(verifierSubpackage, "package.json"), "utf8"));
  assert.equal(manifest.private, true, "the sub-package must never be published");
  assert.match(manifest.dependencies["es-module-lexer"], /^\d+\.\d+\.\d+$/u, "no caret, tilde, range, or \"latest\"");
  const lockfile = JSON.parse(readFileSync(path.join(verifierSubpackage, "package-lock.json"), "utf8"));
  assert.equal(typeof lockfile.lockfileVersion, "number");
  assert.equal(lockfile.packages["node_modules/es-module-lexer"].version, manifest.dependencies["es-module-lexer"]);
});

test("a missing sub-package install fails loudly instead of silently falling back to the repository root's hoisted copy", () => {
  // Node's module resolution walks up parent directories when a package is absent locally, so this
  // proves assertIsolatedResolution() actually catches that fallback rather than merely looking like
  // it would. Destructive but self-restoring: the sub-package's real install is always put back,
  // even if an assertion below throws.
  const nodeModules = path.join(verifierSubpackage, "node_modules");
  const displaced = `${nodeModules}.isolation-test-displaced`;
  rmSync(displaced, { recursive: true, force: true });
  renameSync(nodeModules, displaced);
  try {
    assert.throws(() => {
      execFileSync(process.execPath, [path.join(verifierSubpackage, "parser.mjs"), "--resolve-path"], {
        cwd: verifierSubpackage,
        stdio: "pipe",
      });
    }, /./u, "removing the sub-package's own install must not let resolution silently succeed from elsewhere");
  } finally {
    renameSync(displaced, nodeModules);
  }
  // Confirm the restore actually worked and normal operation resumed.
  const resolved = execFileSync(process.execPath, [path.join(verifierSubpackage, "parser.mjs"), "--resolve-path"], {
    cwd: verifierSubpackage,
    encoding: "utf8",
  }).trim();
  assert.ok(resolved.includes(path.join(verifierSubpackage, "node_modules", "es-module-lexer").split(path.sep).join("/")));
});

test("the verifier sub-package's own dependency tree contains nothing but its one pinned dependency", () => {
  const lockfile = JSON.parse(readFileSync(path.join(verifierSubpackage, "package-lock.json"), "utf8"));
  const installed = Object.keys(lockfile.packages).filter((key) => key !== "");
  assert.deepEqual(installed, ["node_modules/es-module-lexer"]);
});

test("the main closure script never imports es-module-lexer directly; only the isolated sub-package does", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(path.join(repoRoot, "scripts", "verify-target-runtime-closure.js"), "utf8");
  assert.ok(!source.includes('"es-module-lexer"') && !source.includes("'es-module-lexer'"), "the parent process must delegate, not import directly");
  assert.ok(source.includes("tools"), "the parent process must invoke the isolated sub-package");
});
