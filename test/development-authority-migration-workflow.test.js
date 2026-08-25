import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(".github/workflows/development-d1-migration.yml", "utf8");
const runner = await readFile("scripts/run-development-authority-migration.sh", "utf8");

test("migration workflow is manual, account-pinned, main-only, and approval-gated", () => {
  assert.match(workflow, /^\s*workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m);
  assert.match(workflow, /github\.actor == 'jhutchison2222'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /APPLY AUTHORITY MIGRATIONS ONCE/);
  assert.match(workflow, /inputs\.execution_commit == '4a9080ef49fbbca42017a679baad026bbea1c456'/);
  assert.match(workflow, /ref: \$\{\{ inputs\.execution_commit \}\}/);
  assert.match(workflow, /environment: development-d1-migration/);
  assert.match(workflow, /CLOUDFLARE_aiemployees_voice_chat_API_TOKEN_d1/);
  assert.match(workflow, /permissions:\n\s+contents: read/);
  assert.ok(workflow.indexOf("Initialize evidence capture") < workflow.indexOf("Install pinned dependencies"));
  assert.match(workflow, /if-no-files-found: warn/);
  assert.ok(workflow.indexOf("CLOUDFLARE_API_TOKEN") > workflow.indexOf("Capture backup and apply exact migrations once"));
});

test("migration runner pins reviewed authority inputs and contains one apply invocation", () => {
  for (const literal of [
    "727d34322b9e725c482cd041d1d9405772737af3",
    "MIGRATION_EXECUTION_COMMIT",
    "de5e0273347b0b4c5f8f4e554aa2288f",
    "741ade94-8539-4fc8-b6be-24884720dee8",
    "ab865340c48279e6e5654e8e6b0ed52cb9d4af28115c49b47d787ad1ec205d8a",
    "0001_authority_read_model.sql",
    "0006_development_activation_evidence_writes.sql",
  ]) assert.match(runner, new RegExp(literal));

  assert.equal((runner.match(/d1 migrations apply/g) ?? []).length, 1);
  assert.match(runner, /d1 time-travel info/);
  assert.match(runner, /d1 export/);
  assert.match(runner, /Authenticated Wrangler identity did not report the authorized account/);
  assert.match(runner, /Checked-out runtime does not match the reviewed execution commit/);
  assert.match(runner, /pending-before-migrations\.txt/);
  assert.match(runner, /pending-after-migrations\.txt/);
  assert.match(runner, /trap 'rm -f \"\$BACKUP_PATH\"' EXIT/);
});

test("migration runner does not contain adjacent Cloudflare operations or recovery attempts", () => {
  for (const prohibited of [
    /wrangler deploy/,
    /d1 time-travel restore/,
    /d1 delete/,
    /queues create/,
    /queues delete/,
    /secret put/,
    /secret delete/,
  ]) assert.doesNotMatch(runner, prohibited);
  assert.match(runner, /no retry or restore was attempted/);
});
