import { readFile, readdir } from "node:fs/promises";
const roots = [".github","docs","policies","schemas","scripts","src","test","README.md","package.json"];
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[opsu]_[A-Za-z0-9]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9+/_=-]{16,}["']/i,
];
async function files(path) { const stat = await import("node:fs/promises").then((fs) => fs.stat(path)); if (stat.isFile()) return [path]; const out=[]; for (const entry of await readdir(path)) out.push(...await files(`${path}/${entry}`)); return out; }
for (const root of roots) for (const path of await files(root)) {
  const content = await readFile(path, "utf8"); for (const pattern of patterns) if (pattern.test(content)) throw new Error(`Potential secret in ${path}: ${pattern}`);
}
console.log("Secret scan passed: no credential patterns detected.");
