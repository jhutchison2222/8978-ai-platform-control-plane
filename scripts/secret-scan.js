import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const DEFAULT_SECRET_SCAN_ROOTS = Object.freeze([
  ".github", "deployment", "docs", "migrations", "policies", "schemas", "scripts", "src", "test", "tools",
  ".gitignore", "README.md", "package.json", "package-lock.json",
  "vitest.config.js", "worker-configuration.d.ts", "wrangler.jsonc",
  "wrangler.bootstrap.jsonc", "wrangler.cloudflare-admin-v7.example.jsonc",
]);

// Directories that are never scanned even when they appear beneath a configured root: installed
// dependencies are gitignored (never committed; scanning them is pointless and a false-positive
// risk on third-party source) and VCS metadata is never source content. This is a safety net for
// any root, present or future, that happens to contain a package install — tools/, the only current
// example, is exactly such a root (tools/target-runtime-verifier/node_modules).
const EXCLUDED_DIRECTORY_NAMES = new Set(["node_modules", ".git"]);

const patterns = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[opsu]_[A-Za-z0-9]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9+/_=-]{16,}["']/i,
]);
async function files(path) {
  const stat = await import("node:fs/promises").then((fs) => fs.stat(path));
  if (stat.isFile()) return [path];
  const out = [];
  for (const entry of await readdir(path)) {
    if (EXCLUDED_DIRECTORY_NAMES.has(entry)) continue;
    out.push(...await files(`${path}/${entry}`));
  }
  return out;
}

export async function scanSecrets(roots = DEFAULT_SECRET_SCAN_ROOTS) {
  for (const root of roots) for (const path of await files(root)) {
    const content = await readFile(path, "utf8");
    for (const pattern of patterns) if (pattern.test(content)) throw new Error(`Potential secret in ${path}: ${pattern}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await scanSecrets();
  console.log("Secret scan passed: no credential patterns detected.");
}
