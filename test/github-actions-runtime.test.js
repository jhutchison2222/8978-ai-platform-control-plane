import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const workflowDirectory = ".github/workflows";
const isWorkflowFile = (name) => name.endsWith(".yml") || name.endsWith(".yaml");

test("GitHub-hosted JavaScript actions use the Node 24 generation", async () => {
  const workflowNames = (await readdir(workflowDirectory)).filter(isWorkflowFile);
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

// Dependency-reproducibility guard (pre-customer hardening, Part C): package.json's devDependencies
// include several packages pinned to "latest" (a Generation-1 property that cannot be changed
// without re-pinning the reviewed target runtime; see docs/target-runtime-generations.md). The
// repository's actual reproducibility today rests entirely on every workflow installing from the
// committed package-lock.json via `npm ci`, never `npm install`, which would re-resolve "latest"
// fresh and could silently drift the locked versions with no corresponding package.json diff to
// flag it in review. This test is the guardrail: it fails if that ever changes.
test("every workflow installs Node dependencies with npm ci, never npm install", async () => {
  const workflowNames = (await readdir(workflowDirectory)).filter(isWorkflowFile);
  const workflows = await Promise.all(workflowNames.map(async (name) => ({
    name,
    source: await readFile(`${workflowDirectory}/${name}`, "utf8"),
  })));
  const bareNpmInstall = workflows.flatMap(({ name, source }) =>
    [...source.matchAll(/\bnpm install\b/gu)].map(() => name));
  assert.deepEqual(bareNpmInstall, [], "no workflow may install from package.json directly; only npm ci from the committed lockfile is reproducible");
});

test("a .yaml workflow using bare npm install is rejected, not silently skipped for its extension", async (context) => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "8978-workflow-ext-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "fixture.yaml"), "run: npm install\n", "utf8");
  await writeFile(join(directory, "fixture.yml"), "run: npm ci\n", "utf8");
  await writeFile(join(directory, "fixture.txt"), "run: npm install\n", "utf8");

  const workflowNames = (await readdir(directory)).filter(isWorkflowFile);
  assert.deepEqual(workflowNames.sort(), ["fixture.yaml", "fixture.yml"]);
  const workflows = await Promise.all(workflowNames.map(async (name) => ({
    name, source: await readFile(join(directory, name), "utf8"),
  })));
  const bareNpmInstall = workflows.flatMap(({ name, source }) =>
    [...source.matchAll(/\bnpm install\b/gu)].map(() => name));
  assert.deepEqual(bareNpmInstall, ["fixture.yaml"]);
});
