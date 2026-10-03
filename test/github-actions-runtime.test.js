import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const workflowDirectory = ".github/workflows";

test("GitHub-hosted JavaScript actions use the Node 24 generation", async () => {
  const workflowNames = (await readdir(workflowDirectory)).filter((name) => name.endsWith(".yml"));
  const workflows = await Promise.all(workflowNames.map(async (name) => ({
    name,
    source: await readFile(`${workflowDirectory}/${name}`, "utf8"),
  })));

  const legacyReferences = workflows.flatMap(({ name, source }) =>
    [...source.matchAll(/actions\/(?:checkout|setup-node)@v[1-4]\b/g)].map((match) => `${name}: ${match[0]}`));
  assert.deepEqual(legacyReferences, []);

  assert.match(workflows.find(({ name }) => name === "autonomy-supervisor.yml").source, /actions\/checkout@v5/);
  assert.match(workflows.find(({ name }) => name === "autonomy-supervisor.yml").source, /actions\/setup-node@v5/);
  assert.match(workflows.find(({ name }) => name === "validate.yml").source, /actions\/checkout@v5/);
  assert.match(workflows.find(({ name }) => name === "validate.yml").source, /actions\/setup-node@v5/);
});

// Pre-customer hardening (#77 follow-up): every workflow that runs `npm test` against the
// currently checked-out ref must install tools/target-runtime-verifier first, since the closure
// test suite now requires it. The two D1 workflows are a deliberate exception: their checkout step
// pins `ref: ${{ inputs.execution_commit }}` to an exact historical commit (and their job-level `if`
// hard-requires that exact value), predating this sub-package's existence — they run that commit's
// own test suite, never the current one, so they structurally cannot need it. If either workflow's
// pinned commit is ever updated to one that does include the sub-package, this exemption and this
// test must be revisited together.
test("every workflow running npm test against the current ref installs the target-runtime verifier sub-package first", async () => {
  const workflowNames = (await readdir(workflowDirectory)).filter((name) => name.endsWith(".yml"));
  const workflows = await Promise.all(workflowNames.map(async (name) => ({
    name,
    source: await readFile(`${workflowDirectory}/${name}`, "utf8"),
  })));
  const missing = workflows
    .filter(({ source }) => /\bnpm test\b/u.test(source))
    .filter(({ source }) => !/ref:\s*\$\{\{\s*inputs\.\w*commit\w*\s*\}\}/iu.test(source))
    .filter(({ source }) => !/working-directory:\s*tools\/target-runtime-verifier/u.test(source))
    .map(({ name }) => name);
  assert.deepEqual(missing, []);

  // Confirm the exemption is for the reason claimed, not merely asserted: both pinned commits
  // genuinely predate the sub-package's existence, verified directly against Git history.
  const pinnedHistorical = workflows.filter(({ source }) => /ref:\s*\$\{\{\s*inputs\.\w*commit\w*\s*\}\}/iu.test(source));
  assert.ok(pinnedHistorical.length > 0, "this test's premise depends on at least one such workflow existing");
  for (const { name, source } of pinnedHistorical) {
    const pinned = source.match(/default:\s*([0-9a-f]{40})/u)?.[1];
    assert.ok(pinned, `${name} must pin an exact 40-character commit as its default execution_commit`);
    const tree = execFileSync("git", ["ls-tree", "-r", "--name-only", pinned], { encoding: "utf8" });
    assert.ok(!tree.includes("tools/target-runtime-verifier"), `${name}'s pinned commit ${pinned} must not already contain the sub-package`);
  }
});
