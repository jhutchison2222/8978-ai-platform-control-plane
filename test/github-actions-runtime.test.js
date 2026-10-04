import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const workflowDirectory = ".github/workflows";
const isWorkflowFile = (name) => name.endsWith(".yml") || name.endsWith(".yaml");
// npm's documented aliases for `npm install` (https://docs.npmjs.com/cli/v10/commands/npm-install):
// every true prefix of "install" from "i" up, plus "add", plus "it" (short for "install-test": a
// real, registry-resolving install followed by a test run — unlike "install-ci-test"/"cit", which
// use "npm ci" internally and are not a reproducibility risk). (Earlier versions of this list also
// included "isnt"/"isnta"/"isntal"/"isntall" — transpositions, not prefixes, of "inst"/"insta"/
// "instal"/"install" that match no real npm command, and that falsely flagged ordinary text like
// "npm isnt installed" in an availability check.) None of these are prefixes of "ci"/"cit", so this
// cannot false-positive on the ci-based commands this guard allows. "install" may optionally be
// followed by exactly "-test" (its own real alias), but the trailing (?![\w-]) still rejects any
// other hyphenated continuation — in particular "install-ci-test" — since "it"/"install-test" are
// the only two non-ci composites with a hyphen or word boundary that still mean a real install.
// Uses [ \t]+ rather than \s+ between "npm" and the subcommand: \s matches a literal newline, and
// runStepCommandText joins separate, unrelated command lines with "\n" — a plain \s+ could bridge
// one line ending in "npm" into the next line's unrelated leading token and false-positive across
// the join.
const BARE_NPM_INSTALL = /\bnpm[ \t]+(?:install(?:-test)?|i|in|ins|inst|insta|instal|it|add)(?![\w-])/gu;

// Any valid YAML block-scalar header: "|" or ">", with an optional chomping indicator (-/+) and/or
// a single-digit explicit indentation indicator, in either order (both orders are valid YAML).
const BLOCK_SCALAR_HEADER = /^[|>](?:[+-]?[1-9]?|[1-9]?[+-]?)$/u;

function lineIndent(line) {
  return line.match(/^(\s*)/u)[1].length;
}

// Bash (what GitHub Actions' default `run:` shell invokes) treats "#" as a comment start when it
// begins a new word: at the start of the line, after whitespace, or after a control operator like
// ;, &, |, or ( that itself ends the previous word. Used on every piece of text this module pushes
// toward the guard — not just the block-scalar header test below — so a trailing comment (e.g.
// `run: npm ci # see npm install docs` or `run: npm ci;# see npm install docs`) can never be
// mistaken for part of the command itself. Deliberately excludes bare word characters: bash's
// `${VAR#pattern}` prefix-strip (a "#" with no preceding whitespace or operator, common when
// deriving a branch name from GITHUB_REF) is correctly left alone. (This is a line-based heuristic,
// not a full YAML/shell parser: a literal "#" inside a quoted string is also stripped, same
// limitation as the rest of this file's regex-based scanning.)
function stripComment(line) {
  return line.replace(/(?:^|[ \t;&|(])#.*$/u, "");
}

// A deeper-indented line that looks like a new mapping key (`foo:`) or sequence item (`- foo`) is
// YAML structure, not a continuation of the run: value above it — folding it in would swallow
// unrelated keys. Anything else at a deeper indent is a plain- or quoted-scalar continuation line
// (YAML folds such lines into the scalar's value, replacing the newline with a space).
function isScalarContinuation(line, keyIndent) {
  if (line.trim() === "") return false;
  if (lineIndent(line) <= keyIndent) return false;
  return !/^\s*(?:-\s|[\w.-]+:(?:\s|$))/u.test(line);
}

// Extracts only the text of each step's `run:` command — inline (`run: npm ci`, including one
// folded across continuation lines) or block scalar (`run: |` and its variants, followed by a
// more-indented body) — so the guard below matches real command invocations, never a YAML comment,
// a step `name:`, or any other non-command text that happens to contain the words "npm install".
function runStepCommandText(source) {
  const lines = source.split(/\r?\n/u);
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*(?:-\s+)?)run:[ \t]*(.*)$/u);
    if (!match) continue;
    const [, indent, rest] = match;
    const keyIndent = indent.length;
    // YAML allows a comment (and/or trailing whitespace) after a block-scalar header, e.g.
    // `run: | # explain`. The header test needs the comment gone; `rest` itself stays untouched
    // here since in the non-block-scalar branch it is real command text, stripped separately below.
    const headerCandidate = stripComment(rest).trimEnd();
    if (BLOCK_SCALAR_HEADER.test(headerCandidate)) {
      // ">" is a YAML *folded* scalar: lines within one paragraph join with a space; a blank line
      // starts a new paragraph, and paragraphs join with a newline (real YAML folding). "|" is
      // *literal*: every line stays separate, newline-joined regardless of blank lines (handled by
      // the outer commands.join("\n") below, so literal lines are pushed one at a time as before).
      const folded = rest.startsWith(">");
      const paragraphs = [];
      let paragraph = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const line = lines[cursor];
        if (line.trim() === "") {
          if (folded && paragraph.length > 0) { paragraphs.push(paragraph.join(" ")); paragraph = []; }
          cursor += 1;
          continue;
        }
        if (lineIndent(line) <= keyIndent) break;
        if (folded) {
          // A comment-only line is non-blank, but strips to nothing. YAML has no concept of "#" as
          // a comment marker inside a block scalar — it folds the line as plain text — but a real
          // shell then truncates execution at that "#". Either way, the words before and after a
          // comment-only line must never be bridged into one false match, so it is treated exactly
          // like a blank line: a paragraph break, not a word that joins its neighbors with a space.
          const stripped = stripComment(line);
          const content = stripped.trim();
          if (content === "") {
            if (paragraph.length > 0) { paragraphs.push(paragraph.join(" ")); paragraph = []; }
          } else {
            paragraph.push(content);
            // Same reasoning, for a line with real content *before* its comment: once folded into
            // one bash line, that comment extends to the end of the whole line, so nothing folded
            // onto it from later source lines could ever actually run. Close the paragraph here too.
            if (stripped !== line) { paragraphs.push(paragraph.join(" ")); paragraph = []; }
          }
        } else {
          paragraphs.push(stripComment(line));
        }
        cursor += 1;
      }
      if (folded && paragraph.length > 0) paragraphs.push(paragraph.join(" "));
      commands.push(paragraphs.join("\n"));
      index = cursor - 1;
    } else {
      const parts = [stripComment(rest)];
      let cursor = index + 1;
      while (cursor < lines.length && isScalarContinuation(lines[cursor], keyIndent)) {
        parts.push(stripComment(lines[cursor]).trim());
        cursor += 1;
      }
      commands.push(parts.join(" "));
      index = cursor - 1;
    }
  }
  return commands.join("\n");
}

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
    [...runStepCommandText(source).matchAll(BARE_NPM_INSTALL)].map(() => name));
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
    [...runStepCommandText(source).matchAll(BARE_NPM_INSTALL)].map(() => name));
  assert.deepEqual(bareNpmInstall, ["fixture.yaml"]);
});

test("npm's documented install aliases (e.g. npm i) are rejected just like the full npm install, and npm ci is never flagged", async (context) => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "8978-workflow-alias-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "alias-i.yml"), "run: npm i\n", "utf8");
  await writeFile(join(directory, "alias-add.yml"), "run: npm add left-pad\n", "utf8");
  await writeFile(join(directory, "ci-only.yml"), "run: npm ci\n", "utf8");

  const workflowNames = (await readdir(directory)).filter(isWorkflowFile);
  const workflows = await Promise.all(workflowNames.map(async (name) => ({
    name, source: await readFile(join(directory, name), "utf8"),
  })));
  const bareNpmInstall = workflows.flatMap(({ name, source }) =>
    [...runStepCommandText(source).matchAll(BARE_NPM_INSTALL)].map(() => name));
  assert.deepEqual(bareNpmInstall.sort(), ["alias-add.yml", "alias-i.yml"]);
});

test("npm install-ci-test, a real lockfile-respecting npm command, is not misclassified as a bare install", async (context) => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "8978-workflow-composite-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "composite.yml"), "run: npm install-ci-test\n", "utf8");

  const source = await readFile(join(directory, "composite.yml"), "utf8");
  assert.deepEqual([...runStepCommandText(source).matchAll(BARE_NPM_INSTALL)], []);
});

test("the guard only scans actual run: command text, never a YAML comment or a step's name field", async (context) => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "8978-workflow-comment-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      # do not use npm install, use npm ci instead",
    "      - name: Explain why we avoid npm install here",
    "        run: npm ci",
  ].join("\n");
  await writeFile(join(directory, "commented.yml"), fixture, "utf8");

  const source = await readFile(join(directory, "commented.yml"), "utf8");
  assert.deepEqual([...runStepCommandText(source).matchAll(BARE_NPM_INSTALL)], []);
});

test("a bare npm install inside a block-scalar run: body (run: |) is still caught", async (context) => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "8978-workflow-block-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - run: |",
    "          echo preparing",
    "          npm install",
    "          echo done",
    "      - run: npm ci",
  ].join("\n");
  await writeFile(join(directory, "block.yml"), fixture, "utf8");

  const source = await readFile(join(directory, "block.yml"), "utf8");
  assert.equal([...runStepCommandText(source).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("two unrelated commands joined across a newline never bridge into a false npm-install match", () => {
  // "echo building npm" ends in the bare word "npm"; the very next, unrelated command starts with
  // an install-alias token plus a non-word/hyphen character ("i=0"). If the guard's regex let \s
  // match the newline between them, this would falsely read as "npm i".
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - run: |",
    "          echo building npm",
    "          i=0",
    "      - run: npm ci",
  ].join("\n");
  assert.deepEqual([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)], []);
});

for (const header of ["|", ">", "|-", ">-", "|+", ">+", "|2", ">2", "|2+", "|+2"]) {
  test(`a block-scalar run: using the "${header}" header still has its body scanned`, () => {
    const fixture = [
      "jobs:",
      "  test:",
      "    steps:",
      `      - run: ${header}`,
      "          npm install",
    ].join("\n");
    assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
  });

  test(`a block-scalar run: using the "${header}" header includes every line verbatim, even one that resembles a YAML key`, () => {
    // A block-scalar body line like `status: ok` (echoed JSON/status text, not a real shell
    // assignment) can resemble a YAML mapping key. True block-scalar content is included verbatim
    // regardless of its shape — unlike the plain-scalar continuation fallback, which deliberately
    // stops folding at anything key-shaped. This fixture only passes if the header above is
    // genuinely recognized as a block scalar; the fallback path would stop at "status: ok" and
    // never reach "npm install" on the line after it.
    const fixture = [
      "jobs:",
      "  test:",
      "    steps:",
      `      - run: ${header}`,
      "          status: ok",
      "          npm install",
    ].join("\n");
    assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
  });
}

test("a run: value folded across plain-scalar continuation lines is still scanned as one command", () => {
  // Valid YAML: an unquoted scalar value may continue on a following, more-indented line, with the
  // newline folded into a single space.
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - run: npm",
    "          install",
  ].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("a folded continuation stops at the next sibling step, never swallowing an unrelated key", () => {
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - run: npm",
    "          ci",
    "      - name: a later, unrelated step",
    "        run: npm install",
  ].join("\n");
  const matches = [...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)];
  assert.equal(matches.length, 1, "only the second step's genuine bare install should be caught");
});

test("ordinary prose like \"npm isnt installed\" is never mistaken for a bare install", () => {
  // "isnt" (and its own prefixes "isnta"/"isntal"/"isntall") are transpositions, not prefixes, of
  // real npm subcommands ("inst"/"insta"/"instal"/"install") — no npm command named "isnt" exists.
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - run: |",
    '          if ! command -v npm &> /dev/null; then echo "npm isnt installed"; exit 1; fi',
    "      - run: npm ci",
  ].join("\n");
  assert.deepEqual([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)], []);
});

test("a run: header with two or more spaces before a block-scalar indicator is still recognized as a block scalar", () => {
  const fixture = [
    "jobs:",
    "  test:",
    "    steps:",
    "      - run:  |",
    "          status: ok",
    "          npm install",
  ].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("a run: header with two or more spaces before an inline command is still scanned", () => {
  const fixture = ["jobs:", "  test:", "    steps:", "      - run:   npm install"].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("a run: > folded block scalar joins its body with spaces, so npm/install split across lines is still caught", () => {
  // Valid YAML: "run: >" folds its body lines into one space-joined value — GitHub Actions executes
  // this exactly as `npm install`, even though the words sit on separate source lines.
  const fixture = ["jobs:", "  test:", "    steps:", "      - run: >", "          npm", "          install"].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("a run: | literal block scalar keeps each line separate, never bridging unrelated lines into a false match", () => {
  // The companion case to the test above: "|" is literal, not folded, so "npm" ending one line and
  // an unrelated "install_dir=/tmp" starting the next must NOT be read as "npm install_dir".
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: |", "          echo npm", "          install_dir=/tmp",
  ].join("\n");
  assert.deepEqual([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)], []);
});

test("a block-scalar header followed by a trailing YAML comment is still recognized as a block scalar", () => {
  // Valid YAML: a comment may follow a block-scalar header, e.g. "run: | # explain the block". The
  // body here also leads with a key-shaped line, so the fallback plain-scalar path (which stops
  // folding at anything key-shaped) would never reach "npm install" if the header went unrecognized.
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: | # explain the block", "          status: ok", "          npm install",
  ].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("a folded block-scalar header followed by a trailing YAML comment is still recognized, folding its body", () => {
  // The key-shaped "status: ok" line would stop the plain-scalar fallback's continuation folding
  // before "npm install" — this only passes if "> # explain" is genuinely recognized as a block
  // scalar, not coincidentally rescued by that fallback.
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: > # explain", "          status: ok", "          npm", "          install",
  ].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("a block-scalar header followed only by trailing whitespace (no comment) is still recognized", () => {
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: |   ", "          status: ok", "          npm install",
  ].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("a trailing same-line YAML comment mentioning npm install is never read as the command itself", () => {
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: npm ci # TODO: remove legacy npm install fallback",
  ].join("\n");
  assert.deepEqual([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)], []);
});

test("a trailing comment inside a block-scalar body is stripped, not read as part of the command", () => {
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: |",
    "          npm ci # see npm install docs for context",
  ].join("\n");
  assert.deepEqual([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)], []);
});

test("a folded (>) block scalar with a blank-line paragraph break joins within but not across paragraphs", () => {
  // Real YAML folding: a blank line starts a new paragraph, which becomes a newline in the result —
  // not a space — so a line ending in "npm" in one paragraph must never bridge into an install-alias
  // token starting the next paragraph.
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: >",
    "          echo installing npm",
    "",
    "          i=1",
  ].join("\n");
  assert.deepEqual([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)], []);
});

test("a folded (>) block scalar still folds lines within the same paragraph, even with other paragraphs present", () => {
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: >",
    "          echo preparing",
    "",
    "          npm",
    "          install",
  ].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("a '#' not preceded by whitespace (e.g. bash's ${VAR#pattern} prefix-strip) is never mistaken for a comment", () => {
  const fixture = [
    "jobs:", "  test:", "    steps:",
    '      - run: BRANCH="${GITHUB_REF#refs/heads/}" && npm install',
  ].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("a '#' not preceded by whitespace inside a block-scalar body is also left alone", () => {
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: |",
    '          BRANCH="${GITHUB_REF#refs/heads/}" && npm install',
  ].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("a comment-only line inside a folded (>) block scalar is a paragraph break, not a bridge between its neighbors", () => {
  // Real YAML folds "npm" / "# a comment" / "install" to "npm # a comment install"; bash then
  // truncates at the "#", running only "npm". The words on either side of a comment-only line must
  // never be joined into a false "npm install" match.
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: >",
    "          npm",
    "          # a comment",
    "          install",
  ].join("\n");
  assert.deepEqual([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)], []);
});

test("a comment following a shell control operator with no space (e.g. ';#') is still stripped", () => {
  const fixture = ["jobs:", "  test:", "    steps:", "      - run: npm ci;# see npm install docs"].join("\n");
  assert.deepEqual([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)], []);
});

test("comments following other shell control operators (&, |, () with no space are also stripped", () => {
  for (const operator of ["&", "|", "("]) {
    const fixture = ["jobs:", "  test:", "    steps:", `      - run: npm ci ${operator}# see npm install docs`].join("\n");
    assert.deepEqual([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)], [], `operator: ${operator}`);
  }
});

test("${VAR#pattern} immediately followed by a control operator is still left alone, not mistaken for a comment", () => {
  // Guards against an overly broad fix: the operator-awareness above must not regress the earlier
  // ${VAR#pattern} case merely because a control operator appears elsewhere on the same line.
  const fixture = [
    "jobs:", "  test:", "    steps:",
    '      - run: BRANCH="${GITHUB_REF#refs/heads/}"; npm install',
  ].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("npm install-test (the real, registry-resolving install+test alias, not install-ci-test) is flagged", () => {
  const fixture = ["jobs:", "  test:", "    steps:", "      - run: npm install-test"].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("npm it (the short alias for install-test) is flagged", () => {
  const fixture = ["jobs:", "  test:", "    steps:", "      - run: npm it"].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});

test("npm install-ci-test is still correctly spared even with install-test/it now recognized", () => {
  const fixture = ["jobs:", "  test:", "    steps:", "      - run: npm install-ci-test"].join("\n");
  assert.deepEqual([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)], []);
});

test("a folded (>) paragraph with real content before an inline comment closes there, never folding a later line in", () => {
  // Real YAML folds "git log && npm" / "install" to "git log && npm install" as plain text, but bash
  // then reads the trailing "#" on the first line as starting a comment that swallows everything to
  // the end of that already-joined line — "install" never actually runs.
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: >",
    "          git log && npm # verify before running install manually",
    "          install",
  ].join("\n");
  assert.deepEqual([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)], []);
});

test("a folded (>) paragraph still folds everything before the inline comment, and a later paragraph can still be flagged", () => {
  const fixture = [
    "jobs:", "  test:", "    steps:",
    "      - run: >",
    "          echo building # note",
    "",
    "          npm install",
  ].join("\n");
  assert.equal([...runStepCommandText(fixture).matchAll(BARE_NPM_INSTALL)].length, 1);
});
