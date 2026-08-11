import { readFile, readdir } from "node:fs/promises";
import { digestCanonicalValue } from "../src/canonical-digest.js";
import { TRUSTED_POLICY_SET_DIGESTS } from "../src/trusted-policy-sets.js";
import { validateSchema } from "./json-schema-lite.js";

const jsonDirectories = ["schemas", "policies"];
for (const directory of jsonDirectories) {
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".json")) continue;
    JSON.parse(await readFile(`${directory}/${file}`, "utf8"));
  }
}

const policies = JSON.parse(
  await readFile("policies/development-standing-policies.json", "utf8"),
);
const policySchema = JSON.parse(await readFile("schemas/standing-policy.schema.json", "utf8"));
const schemaErrors = validateSchema(policySchema, policies);
if (schemaErrors.length > 0) throw new Error(`Policy schema validation failed:\n${schemaErrors.join("\n")}`);
const trustKey = `${policies.policySetId}@${policies.policySetVersion}`;
if (await digestCanonicalValue(policies) !== TRUSTED_POLICY_SET_DIGESTS[trustKey]) {
  throw new Error(`Policy trust-anchor digest mismatch: ${trustKey}`);
}
const ids = new Set();
for (const policy of policies.policies) {
  const key = `${policy.id}@${policy.version}`;
  if (ids.has(key)) throw new Error(`Duplicate policy version: ${key}`);
  ids.add(key);
  if (policy.environments.includes("production")) {
    throw new Error(`Development bootstrap includes production: ${key}`);
  }
  if (!policy.approvedBy || !policy.approvalReference || !policy.validFrom) {
    throw new Error(`Policy is missing approval provenance: ${key}`);
  }
  const hasPlaceholder = policy.resources.some((resource) =>
    resource.id.startsWith("__OWNER_APPROVED_"),
  );
  if (hasPlaceholder && policy.enabled) {
    throw new Error(`Placeholder policy must be disabled: ${key}`);
  }
}

console.log(`Validated ${ids.size} development policy versions and all JSON artifacts.`);
