import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_SECRET_SCAN_ROOTS, scanSecrets } from "../scripts/secret-scan.js";

// Future-proofing for the hardcoded roots list (pre-customer hardening, #77 follow-up): this test
// would have caught both the tools/ omission and the two missing wrangler config files before this
// fix, and will catch any future new top-level committed file or directory that nobody remembers to
// add. It compares the roots list against Git's own record of what is actually tracked at the
// repository root — not the filesystem (which would also see gitignored, untracked local state like
// node_modules or .wrangler) and not a second hand-maintained list (which would be exactly as
// fragile as the one it is meant to check).
test("every top-level git-tracked entry is covered by the secret-scan roots", () => {
  const tracked = execFileSync("git", ["ls-tree", "--name-only", "HEAD"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((name) => name.length > 0);
  const uncovered = tracked.filter((name) => !DEFAULT_SECRET_SCAN_ROOTS.includes(name));
  assert.deepEqual(uncovered, [], "a top-level tracked file or directory is not in DEFAULT_SECRET_SCAN_ROOTS");
});

test("default secret scan covers deploy-adjacent top-level configuration", () => {
  for (const path of ["wrangler.jsonc", "vitest.config.js", "package-lock.json", "worker-configuration.d.ts"]) {
    assert.ok(DEFAULT_SECRET_SCAN_ROOTS.includes(path), `${path} is not scanned`);
  }
});

test("default secret scan covers D1 migrations", () => {
  assert.ok(DEFAULT_SECRET_SCAN_ROOTS.includes("migrations"), "migrations are not scanned");
});

test("default secret scan covers deployment preflight manifests", () => {
  assert.ok(DEFAULT_SECRET_SCAN_ROOTS.includes("deployment"), "deployment manifests are not scanned");
});

test("secret scan rejects credentials in deployment-adjacent configuration", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "8978-secret-scan-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const credential = ["api", "key"].join("_") + " = \"" + "a".repeat(32) + "\"";

  for (const name of ["wrangler.jsonc", "vitest.config.js", "development-activation-plan.json"]) {
    const path = join(directory, name);
    await writeFile(path, credential, "utf8");
    await assert.rejects(scanSecrets([path]), new RegExp(`Potential secret in .*${name.replace(".", "\\.")}`));
  }
});
