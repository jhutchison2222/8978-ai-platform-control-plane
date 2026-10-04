import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const workflowDirectory = ".github/workflows";
const isWorkflowFile = (name) => name.endsWith(".yml") || name.endsWith(".yaml");

// npm's documented aliases for `npm install` (https://docs.npmjs.com/cli/v10/commands/npm-install):
// every true prefix of "install" from "i" up, plus "add", plus "it" (short for "install-test": a
// real, registry-resolving install followed by a test run — unlike "install-ci-test"/"cit", which
// use "npm ci" internally and are not a reproducibility risk). None of these are prefixes of
// "ci"/"cit", so this cannot false-positive on the ci-based commands this guard allows. "install"
// may optionally be followed by exactly "-test" (its own real alias), but the trailing (?![\w-])
// still rejects any other hyphenated continuation — in particular "install-ci-test".
//
// Deliberately simple and fail-closed: this scans each workflow's whole raw file text, not a parsed
// run: command. It does not distinguish a real shell invocation from a YAML comment, a step `name:`,
// or block-scalar folding — a maintainer who writes a comment mentioning "npm install" will need to
// reword it. That occasional false positive is the accepted, cheap-to-fix cost of avoiding a
// hand-rolled YAML/shell parser: a prior, far more "precise" version of this guard needed over a
// dozen rounds of edge-case fixes (block-scalar header variants, folded-vs-literal joining, comment
// stripping, paragraph breaks, shell control operators...) and still could not be fully trusted not
// to have another gap. A real bare install silently slipping through undetected is the only failure
// mode this guard cannot tolerate; an occasional reword is a trivial one.
const BARE_NPM_INSTALL = /\bnpm\s+(?:install(?:-test)?|i|in|ins|inst|insta|instal|it|add)(?![\w-])/gu;

async function readWorkflows() {
  const workflowNames = (await readdir(workflowDirectory)).filter(isWorkflowFile);
  return Promise.all(workflowNames.map(async (name) => ({
    name,
    source: await readFile(`${workflowDirectory}/${name}`, "utf8"),
  })));
}

test("GitHub-hosted JavaScript actions use the Node 24 generation", async () => {
  const workflows = await readWorkflows();

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
  const workflows = await readWorkflows();
  const bareNpmInstall = workflows.flatMap(({ name, source }) =>
    [...source.matchAll(BARE_NPM_INSTALL)].map(() => name));
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
    [...source.matchAll(BARE_NPM_INSTALL)].map(() => name));
  assert.deepEqual(bareNpmInstall, ["fixture.yaml"]);
});

// BARE_NPM_INSTALL carries the "g" flag (required for matchAll elsewhere in this file), and a
// global regex's lastIndex persists across uses of the same instance — calling .test() or
// assert.match() with it repeatedly gives inconsistent results. matchAll() always starts fresh
// regardless of lastIndex, so every check here goes through it instead.
const matches = (text) => [...text.matchAll(BARE_NPM_INSTALL)].length > 0;

test("npm's documented install aliases (e.g. npm i) are rejected just like the full npm install, and npm ci is never flagged", () => {
  for (const alias of ["install", "i", "in", "ins", "inst", "insta", "instal", "add"]) {
    assert.equal(matches(`run: npm ${alias}`), true, alias);
  }
  assert.equal(matches("run: npm ci"), false);
});

test("npm install-test and its short alias it (real, registry-resolving installs, unlike install-ci-test) are flagged", () => {
  assert.equal(matches("run: npm install-test"), true);
  assert.equal(matches("run: npm it"), true);
});

test("npm install-ci-test, a real lockfile-respecting npm command, is not misclassified as a bare install", () => {
  assert.equal(matches("run: npm install-ci-test"), false);
});

test("ordinary prose like \"npm isnt installed\" is never mistaken for a bare install", () => {
  // "isnt" (and its own prefixes "isnta"/"isntal"/"isntall") are transpositions, not prefixes, of
  // real npm subcommands ("inst"/"insta"/"instal"/"install") — no npm command named "isnt" exists.
  assert.equal(matches('run: if ! command -v npm &> /dev/null; then echo "npm isnt installed"; exit 1; fi'), false);
});

test("a comment or step name merely mentioning npm install is also flagged — an accepted, cheap-to-fix false positive, not a bug", () => {
  // This guard scans raw file text, not a parsed run: command, by design (see the comment on
  // BARE_NPM_INSTALL above). A maintainer hitting this on a genuinely compliant workflow needs only
  // to reword the comment or step name; that tradeoff is what keeps this guard simple and reliable.
  assert.equal(matches("# do not use npm install, use npm ci instead"), true);
});
