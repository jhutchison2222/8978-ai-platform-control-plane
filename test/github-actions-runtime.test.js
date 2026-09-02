import assert from "node:assert/strict";
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
