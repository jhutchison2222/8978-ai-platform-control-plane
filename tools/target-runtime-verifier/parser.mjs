#!/usr/bin/env node
// Mechanism A of the target-runtime closure verifier: an es-module-lexer module-graph walk, no
// regular expressions. Deliberately isolated in this sub-package (own package.json, own exact
// pinned es-module-lexer version, own lockfile, own node_modules) so Generation-1 target-runtime
// provenance never depends on what the repository root happens to hoist, or on a transitive
// devDependency of an unrelated tool. Node resolves the bare "es-module-lexer" specifier below
// relative to this file's own directory first, so this always uses this sub-package's pinned
// install regardless of what is or is not present at the repository root.
//
// Invoked as a child process by ../../scripts/verify-target-runtime-closure.js. Reads --entry and
// --root from argv, writes exactly one JSON object to stdout: { local, external, failures }, with
// local/external as sorted arrays (the parent process reconstructs them as Sets). Performs no
// Cloudflare call, reads no credential, and writes no file.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const toPosix = (value) => value.split(path.sep).join("/");
const thisDirectory = path.dirname(fileURLToPath(import.meta.url));

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || typeof process.argv[index + 1] !== "string") {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
}

// Node's module resolution walks up parent directories when a package is absent from the nearest
// node_modules, so a missing or incomplete install of THIS sub-package would otherwise silently
// fall back to whatever happens to be hoisted at the repository root — precisely the accidental
// coupling this isolation exists to prevent. Fail loudly instead of ever silently falling back.
function assertIsolatedResolution() {
  const resolved = import.meta.resolve("es-module-lexer");
  const expectedPrefix = pathToFileURL(path.join(thisDirectory, "node_modules", "es-module-lexer") + path.sep).href;
  if (!resolved.startsWith(expectedPrefix)) {
    throw new Error(
      `es-module-lexer resolved from ${resolved}, not this sub-package's own node_modules (expected ` +
      `under ${expectedPrefix}). Run \`npm ci\` inside tools/target-runtime-verifier before invoking this script.`,
    );
  }
  return resolved;
}

export async function parserClosure(entry, root) {
  assertIsolatedResolution();
  const lexer = await import("es-module-lexer");
  await lexer.init;
  const failures = [];
  const seen = new Set();
  const external = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (rel.endsWith(".json")) continue;
    const text = readFileSync(path.join(root, rel), "utf8");
    let imports;
    try {
      [imports] = lexer.parse(text, rel);
    } catch (error) {
      failures.push(`target runtime module ${rel} could not be parsed: ${error instanceof Error ? error.message : "unknown parse failure"}`);
      continue;
    }
    for (const record of imports) {
      if (record.d >= 0) { failures.push(`dynamic import expression in ${rel} is unresolved; dynamic imports are a stop condition`); continue; }
      if (record.d === -2) continue;
      const spec = record.n;
      if (typeof spec !== "string") { failures.push(`non-literal import specifier in ${rel} cannot be resolved; this is a stop condition`); continue; }
      if (!spec.startsWith(".")) { external.add(spec); continue; }
      const base = toPosix(path.posix.join(path.posix.dirname(rel), spec));
      const candidates = [base, `${base}.js`, `${base}.json`, `${base}/index.js`];
      const resolved = candidates.find((candidate) => {
        try { return statSync(path.join(root, candidate)).isFile(); } catch { return false; }
      });
      if (!resolved) { failures.push(`unresolved relative import in ${rel}: ${spec}`); continue; }
      queue.push(resolved);
    }
  }
  return { local: seen, external, failures };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${toPosix(process.argv[1])}`).href;
if (invokedDirectly) {
  if (process.argv.includes("--resolve-path")) {
    // Isolation proof for tests: prints where this process actually resolved es-module-lexer from,
    // with no other output, so a test can assert it is this sub-package's own node_modules.
    console.log(assertIsolatedResolution());
  } else {
    const entry = readArg("--entry");
    const root = readArg("--root");
    const result = await parserClosure(entry, root);
    console.log(JSON.stringify({
      local: [...result.local].sort(),
      external: [...result.external].sort(),
      failures: result.failures,
    }));
  }
}
