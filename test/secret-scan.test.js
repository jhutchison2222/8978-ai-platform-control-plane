import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_SECRET_SCAN_ROOTS, scanSecrets } from "../scripts/secret-scan.js";

test("default secret scan covers deploy-adjacent top-level configuration", () => {
  for (const path of ["wrangler.jsonc", "vitest.config.js", "package-lock.json", "worker-configuration.d.ts"]) {
    assert.ok(DEFAULT_SECRET_SCAN_ROOTS.includes(path), `${path} is not scanned`);
  }
});

test("default secret scan covers D1 migrations", () => {
  assert.ok(DEFAULT_SECRET_SCAN_ROOTS.includes("migrations"), "migrations are not scanned");
});

test("secret scan rejects credentials in Wrangler and Vitest configuration", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "8978-secret-scan-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const credential = ["api", "key"].join("_") + " = \"" + "a".repeat(32) + "\"";

  for (const name of ["wrangler.jsonc", "vitest.config.js"]) {
    const path = join(directory, name);
    await writeFile(path, credential, "utf8");
    await assert.rejects(scanSecrets([path]), new RegExp(`Potential secret in .*${name.replace(".", "\\.")}`));
  }
});
