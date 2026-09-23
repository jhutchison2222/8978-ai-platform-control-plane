// Exact target-runtime provenance for the 8978-ai-control-plane-dev Worker.
// Digests are SHA-256 over Git blob bytes at the reviewed target commit, never a CRLF working copy.
// This module is deliberately NOT reachable from the target entrypoint; validation proves it.

export const TARGET_WORKER_COMMIT = "371b02d797528f175e9e6075aef6fc92757dfd52";
export const TARGET_CONFIGURATION_SHA256 = "f011600fb1835dcdf9f6491f4b27613004e58e37a1cd5ef9b2b5697859ab40a6";
export const TARGET_ENTRYPOINT = "src/control-plane-worker.js";
export const PERMITTED_EXTERNAL_SPECIFIERS = Object.freeze(["cloudflare:workers"]);

export const TARGET_RUNTIME_INPUTS = Object.freeze({
  "policies/development-standing-policies.json": "b343f521ce555745b6a8f39908c010b9d8aa3da9c69ed303ba933b14e598a055",
  "src/canonical-digest.js": "ce61cff2026b6ed3fbbf53e3ae4b1a92693a751edda697849b40559986e18c48",
  "src/cloudflare-orchestrator-adapters.js": "0f85f119875b1ba448272afe366939fb034258c1a8b3141f3b1cc2b062ee39a4",
  "src/cloudflare-replay-store.js": "94b0e4bd52c153277c62a75788d8d9f3843ca48b58776e96a774628ae5bd4e8e",
  "src/cloudflare-runtime-stores.js": "675b8419aec7c38c7184baed1e451bac968bc3bb699c789b0950cf32dd02c54b",
  "src/control-plane-state-durable-objects.js": "5a06434674f36ad4fd933e8f0f3f0e1837539a490fb2b20c461c38f08940e734",
  "src/control-plane-worker.js": "5b2b4278f16a4644a4b1a2b6d0b8fb6048a0c57a9075f698fa50c60f3b8b3bf4",
  "src/d1-authority-runtime-composition.js": "90454f1f226f821bcae539fbb8853b5279aa0170e7c3ba4388ed4c790e887914",
  "src/d1-authority-runtime.js": "97f2a0e9c57d1794fde18a712e6b3ff6ce28d0b0cef584b1529388c587928b2c",
  "src/d1-owner-control-runtime.js": "7e4fb96cfe9eb88ae580cd4839ca0468d5d43e68ed1226c938a8ebd18033f13d",
  "src/d1-project-knowledge-runtime.js": "34a530cf80ecebbbb3889cfd9cb8b7bbae7b8ce7ae9e40bb626e5695ffd3fb09",
  "src/d1-validation-runtime.js": "66f316c8e0fe7f0319838de4a97189d0f6e55f6ab3d546537d0a04630490eb7f",
  "src/development-runtime.js": "272517b4d0904af4872c08250e5a35629d3f9682eda8e76e467cdc48039f5b61",
  "src/orchestrator-workflow.js": "d7d532fe278ac9fed3593b6316d6b488e0651e97f492b590e7e3a83e6714bc6f",
  "src/policy-gateway.js": "dd3f331ae6a85689c4e40626b3d6accf352adc2aa4e450b51694abfa2d31bb10",
  "src/resource-contract.js": "f4969235b2269ae6dc0b581880ba410ee6d50ec3bcdd8899ae00413287693cd2",
  "src/runtime-contracts.js": "b0b860d57efb8ecabcf6fea5a6ad0d1276fd1e113845fedf82bbe4d90dec6dd7",
  "src/service-auth-adapter.js": "c136cd644a93775dd44c8c98dd92d529bf2c63235902cb6b83bb644a6e30d495",
  "src/service-auth-replay-durable-object.js": "dd9a252dc218b50ce82f5a92ab756b4759b78d95b2bb5ad1a2259cccd51fcae3",
  "src/service-auth.js": "eb9613712d3a94db45ee7887f459999c127e384ae086f14b2c991f52c84368aa",
  "src/trusted-policy-sets.js": "5d32853c7ea047f0eac819fc4de15e31d9b814a796bcd3860e5eb521d12c91be",
  "src/unavailable-runtime.js": "7c878f5de2f44818bd42d991bf7e34fae38076b7dcf24f948cb47d3d951b88c9",
});

export const TARGET_MIGRATIONS = Object.freeze({
  "migrations/authority/0001_authority_read_model.sql": "fded8c2fe248ecd7cfbb1214d0449f012b7099220f85e80fcd3012b3b9ade424",
  "migrations/authority/0002_validation_evidence.sql": "75e03891d1b93baf4d10bb0d248b9779405b31f78458f6874e629c320ed5b4b9",
  "migrations/authority/0003_governing_project_knowledge.sql": "8383c73014a72d30fd179628b0ff8411bf0ab27572585a281279227d03fb3c7a",
  "migrations/authority/0004_owner_control.sql": "4f7d4cb7939eefb8e6c2f7f292c7e806399b3366e135d775fa317214d7f67185",
  "migrations/authority/0005_development_activation_evidence.sql": "4f75b03549ab1df797fb73a87768291caf921a22f796939c7b466eea3eb528c3",
  "migrations/authority/0006_development_activation_evidence_writes.sql": "0bf3e2dbdd935fe6c2ecbd310d8c465e2bca845569a0d10e52e0ac563a181eb4",
});

export const TARGET_PROTECTED_FILES = Object.freeze({
  "wrangler.jsonc": "f011600fb1835dcdf9f6491f4b27613004e58e37a1cd5ef9b2b5697859ab40a6",
  "package.json": "d472a0c8690a49fa77ecfe96e9369dc2bcd6c00fec1c0e33b4b94e8b1aae15a4",
  "package-lock.json": "084ee000a6c34359d45f3642facd5672ac31cea299f8ded6c222ab99d839c1b8",
});

export const TARGET_PACKAGE_INVARIANT_FIELDS = Object.freeze([
  "name", "version", "private", "type", "scripts", "dependencies", "devDependencies", "engines",
]);

export const TARGET_RUNTIME_MANIFEST = Object.freeze({
  targetWorkerCommit: TARGET_WORKER_COMMIT,
  targetConfigurationSha256: TARGET_CONFIGURATION_SHA256,
  entrypoint: TARGET_ENTRYPOINT,
  permittedExternalSpecifiers: PERMITTED_EXTERNAL_SPECIFIERS,
  runtimeInputs: TARGET_RUNTIME_INPUTS,
  migrations: TARGET_MIGRATIONS,
  protectedFiles: TARGET_PROTECTED_FILES,
  packageInvariantFields: TARGET_PACKAGE_INVARIANT_FIELDS,
});
