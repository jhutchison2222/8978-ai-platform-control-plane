#!/usr/bin/env node
// Authoritative target-runtime closure verification for 8978-ai-control-plane-dev.
//
// Two independent mechanisms must both equal the reviewed manifest:
//   A. the pinned es-module-lexer parser (module-graph walk, no regular expressions)
//   B. Wrangler's own credential-free dry-run build input set (sourcemap sources)
//
// This script performs no Cloudflare call, reads no credential, and writes no record.
// The Wrangler dry run is explicitly local-only: Cloudflare credentials are stripped
// from the child environment so the build cannot authenticate even if one is present.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERMITTED_EXTERNAL_SPECIFIERS,
  TARGET_ENTRYPOINT,
  TARGET_MIGRATIONS,
  TARGET_PROTECTED_FILES,
  TARGET_RUNTIME_INPUTS,
  TARGET_WORKER_COMMIT,
} from "../src/target-runtime-manifest.js";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const toPosix = (value) => value.split(path.sep).join("/");

// Keys that would let inputs enter the bundle, or traffic reach the Worker, outside the manifest.
export const PROHIBITED_CONFIG_KEYS = Object.freeze([
  "rules", "alias", "build", "find_additional_modules", "no_bundle", "site", "assets", "routes", "route",
]);

export function gitBlob(commit, file) {
  return execFileSync("git", ["cat-file", "blob", `${commit}:${file}`], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// Digest of the canonical LF content of a working-tree file. Equal to the Git blob digest for
// text files under core.autocrlf, and defined for files that are not yet committed.
export function normalizedFileDigest(file, root = repoRoot) {
  const raw = readFileSync(path.join(root, file), "utf8");
  return sha256(Buffer.from(raw.replace(/\r\n/gu, "\n"), "utf8"));
}

export function verifyDigests(label, entries, commit) {
  const failures = [];
  for (const [file, expected] of Object.entries(entries)) {
    let actual;
    try {
      actual = commit === "WORKTREE" ? normalizedFileDigest(file) : sha256(gitBlob(commit, file));
    } catch {
      failures.push(`${label}: ${file} is missing at ${commit}`);
      continue;
    }
    if (actual !== expected) failures.push(`${label}: ${file} digest ${actual} does not equal reviewed ${expected}`);
  }
  return failures;
}

export function assertConfigSurface(config) {
  const failures = [];
  for (const key of PROHIBITED_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      failures.push(`target configuration declares a bundler- or routing-affecting key that is not reviewed: ${key}`);
    }
  }
  if (config.main !== TARGET_ENTRYPOINT) {
    failures.push(`target configuration entrypoint ${config.main} does not equal reviewed ${TARGET_ENTRYPOINT}`);
  }
  return failures;
}

// Set equality against the reviewed manifest, plus explicit exclusion of connector and validation files.
export function compareToManifest(label, actual, manifestPaths = new Set(Object.keys(TARGET_RUNTIME_INPUTS))) {
  const failures = [];
  for (const file of actual) if (!manifestPaths.has(file)) failures.push(`${label}: ${file} entered the target bundle but is not in the reviewed manifest`);
  for (const file of manifestPaths) if (!actual.has(file)) failures.push(`${label}: reviewed manifest input ${file} is absent from the bundle input set`);
  for (const file of actual) {
    if (file.includes("cloudflare-admin-v7")) failures.push(`${label}: Admin v7 connector file entered the target bundle: ${file}`);
    if (file.includes("target-runtime-manifest") || file.includes("validate-artifacts") || file.includes("verify-target-runtime-closure")) {
      failures.push(`${label}: manifest or validation file entered the target bundle: ${file}`);
    }
  }
  return failures;
}

export function compareMechanisms(parserSet, bundlerSet) {
  const failures = [];
  for (const file of bundlerSet) if (!parserSet.has(file)) failures.push(`mechanism divergence: ${file} is a bundle input but the parser did not reach it`);
  for (const file of parserSet) if (!bundlerSet.has(file)) failures.push(`mechanism divergence: ${file} was reached by the parser but is not a bundle input`);
  return failures;
}

export function assertExternalSpecifiers(external) {
  return [...external]
    .filter((spec) => !PERMITTED_EXTERNAL_SPECIFIERS.includes(spec))
    .map((spec) => `unexpected external runtime specifier: ${spec}`);
}

// ---------------------------------------- mechanism A: es-module-lexer parser ---
export async function parserClosure(entry = TARGET_ENTRYPOINT, root = repoRoot) {
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

// --------------------------- mechanism B: Wrangler credential-free dry run ---
export function wranglerClosure() {
  const outDir = mkdtempSync(path.join(tmpdir(), "8978-closure-"));
  const failures = [];
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" };
  for (const key of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL", "CF_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    delete env[key];
  }
  try {
    // Invoke Wrangler's JS entrypoint with the current Node binary: no shell, no .cmd shim.
    const wranglerEntry = path.join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");
    execFileSync(
      process.execPath,
      [wranglerEntry, "versions", "upload", "--config", "wrangler.jsonc", "--dry-run", "--outdir", outDir],
      { cwd: repoRoot, env, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 },
    );
    const emitted = readdirSync(outDir);
    const entryName = path.basename(TARGET_ENTRYPOINT);
    const allowed = new Set(["README.md", entryName, `${entryName}.map`]);
    for (const name of emitted) {
      if (!allowed.has(name)) failures.push(`Wrangler emitted an unexpected bundle artifact that the manifest does not describe: ${name}`);
    }
    const mapName = `${entryName}.map`;
    if (!emitted.includes(mapName)) throw new Error("Wrangler dry run did not emit the sourcemap required to enumerate build inputs");
    const map = JSON.parse(readFileSync(path.join(outDir, mapName), "utf8"));
    // Sourcemap sources are relative to the output directory; resolve them and re-root on the repository.
    const sources = new Set(map.sources.map((value) => toPosix(path.relative(repoRoot, path.resolve(outDir, value)))));
    return { sources, failures };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

export async function verifyTargetRuntimeClosure({ againstCommit = TARGET_WORKER_COMMIT, skipBundler = false } = {}) {
  const failures = [];
  failures.push(...verifyDigests("target runtime input", TARGET_RUNTIME_INPUTS, againstCommit));
  failures.push(...verifyDigests("target migration", TARGET_MIGRATIONS, againstCommit));
  failures.push(...verifyDigests("protected file", TARGET_PROTECTED_FILES, againstCommit));
  failures.push(...verifyDigests("target runtime input (worktree)", TARGET_RUNTIME_INPUTS, "WORKTREE"));
  failures.push(...verifyDigests("target migration (worktree)", TARGET_MIGRATIONS, "WORKTREE"));
  failures.push(...verifyDigests("protected file (worktree)", TARGET_PROTECTED_FILES, "WORKTREE"));

  const configText = readFileSync(path.join(repoRoot, "wrangler.jsonc"), "utf8");
  const config = JSON.parse(configText.replace(/^\s*\/\/.*$/gmu, ""));
  failures.push(...assertConfigSurface(config));

  const parser = await parserClosure();
  failures.push(...parser.failures);
  failures.push(...compareToManifest("es-module-lexer parser closure", parser.local));
  failures.push(...assertExternalSpecifiers(parser.external));

  let bundlerInputs = null;
  if (!skipBundler) {
    const bundler = wranglerClosure();
    failures.push(...bundler.failures);
    failures.push(...compareToManifest("Wrangler dry-run closure", bundler.sources));
    failures.push(...compareMechanisms(parser.local, bundler.sources));
    bundlerInputs = bundler.sources.size;
  }

  return {
    ok: failures.length === 0,
    failures,
    summary: {
      againstCommit,
      manifestInputs: Object.keys(TARGET_RUNTIME_INPUTS).length,
      parserInputs: parser.local.size,
      bundlerInputs,
      migrations: Object.keys(TARGET_MIGRATIONS).length,
      protectedFiles: Object.keys(TARGET_PROTECTED_FILES).length,
      externalSpecifiers: [...parser.external],
    },
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${toPosix(process.argv[1])}`).href;
if (invokedDirectly) {
  const index = process.argv.indexOf("--against");
  const result = await verifyTargetRuntimeClosure({
    againstCommit: index === -1 ? TARGET_WORKER_COMMIT : process.argv[index + 1],
    skipBundler: process.argv.includes("--skip-bundler"),
  });
  console.log(JSON.stringify(result.summary, null, 2));
  if (!result.ok) {
    for (const failure of result.failures) console.error(`FAIL ${failure}`);
    console.error(`target-runtime closure verification failed with ${result.failures.length} finding(s)`);
    process.exit(1);
  }
  console.log("Target runtime closure verified: parser and bundler input sets both equal the reviewed manifest.");
}
