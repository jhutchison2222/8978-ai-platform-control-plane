import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(".github/workflows/development-d1-schema-inventory.yml", "utf8");

test("schema inventory workflow is manual, owner-only, main-only, and immutable", () => {
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule|workflow_run):/m);
  assert.match(workflow, /github\.repository == 'jhutchison2222\/8978-ai-platform-control-plane'/);
  assert.match(workflow, /github\.actor == 'jhutchison2222'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /VERIFY AUTHORITY SCHEMA READ ONLY ONCE/);
  assert.match(workflow, /inputs\.execution_commit == '1a7a8d5f21c016524f10eee31d087d5952c061f3'/);
  assert.match(workflow, /ref: \$\{\{ inputs\.execution_commit \}\}/);
  assert.match(workflow, /SCHEMA_VERIFICATION_EXECUTION_COMMIT: \$\{\{ inputs\.execution_commit \}\}/);
  assert.match(workflow, /permissions:\n\s+contents: read/);
});

test("schema inventory workflow scopes credentials to the one read-only runner step", () => {
  assert.match(workflow, /environment: development-d1-migration/);
  assert.match(workflow, /CLOUDFLARE_aiemployees_voice_chat_API_TOKEN_d1/);
  assert.equal((workflow.match(/CLOUDFLARE_API_TOKEN/g) ?? []).length, 1);
  assert.ok(workflow.indexOf("CLOUDFLARE_API_TOKEN") > workflow.indexOf("Run exact read-only schema inventory once"));
  assert.match(workflow, /bash scripts\/run-development-authority-schema-inventory-verification\.sh/);
  assert.doesNotMatch(workflow, /d1 (?:execute|migrations|export|delete)/);
  assert.doesNotMatch(workflow, /wrangler deploy/);
});

test("schema inventory workflow initializes and always uploads sanitized evidence", () => {
  assert.ok(workflow.indexOf("Initialize evidence capture") < workflow.indexOf("Install pinned dependencies"));
  assert.ok(workflow.indexOf("Validate repository artifacts") < workflow.indexOf("Run exact read-only schema inventory once"));
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /if-no-files-found: warn/);
  assert.match(workflow, /retention-days: 7/);
  assert.match(workflow, /cancel-in-progress: false/);
});
