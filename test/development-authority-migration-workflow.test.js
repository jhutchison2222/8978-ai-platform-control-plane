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
  assert.match(workflow, /inputs\.execution_commit == '33042914d8a1d10018197c8cf5b7218ddaceb3c1'/);
  assert.match(workflow, /ref: \$\{\{ inputs\.execution_commit \}\}/);
  assert.match(workflow, /MIGRATION_EXECUTION_COMMIT: \$\{\{ inputs\.execution_commit \}\}/);
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
  assert.match(runner, /if \"\$WRANGLER\" d1 migrations apply/);
  assert.doesNotMatch(runner, /set \+e/);
  assert.match(runner, /trap 'record_unhandled_error' ERR/);
  assert.match(runner, /trap 'cleanup_sensitive_files' EXIT/);
  assert.match(runner, /\$\{RUNNER_TEMP\}\/development-authority-whoami\.txt/);
  assert.match(runner, /\$\{RUNNER_TEMP\}\/development-authority-d1-list\.json/);
  assert.match(runner, /pre-migration-d1-target\.json/);
  assert.doesNotMatch(runner, /\$EVIDENCE_DIR\/pre-migration-d1-list\.json/);
  assert.doesNotMatch(runner, /\$EVIDENCE_DIR\/operator\.txt/);
});

test("migration runner verifies placement from d1 info rather than d1 list", () => {
  const d1InfoCommand = runner.indexOf('"$WRANGLER" d1 info');
  const listGuardStart = runner.indexOf("\njq -e", d1InfoCommand);
  const infoGuardStart = runner.indexOf("\njq -e", listGuardStart + 1);
  const timeTravelStart = runner.indexOf('\n"$WRANGLER" d1 time-travel info', infoGuardStart);

  assert.ok(d1InfoCommand >= 0);
  assert.ok(listGuardStart > d1InfoCommand);
  assert.ok(infoGuardStart > listGuardStart);
  assert.ok(timeTravelStart > infoGuardStart);

  const listGuard = runner.slice(listGuardStart, infoGuardStart);
  const infoGuard = runner.slice(infoGuardStart, timeTravelStart);

  assert.match(listGuard, /pre-migration-d1-target\.json/);
  assert.match(listGuard, /\.version == "production"/);
  assert.doesNotMatch(listGuard, /running_in_region/);
  assert.match(infoGuard, /pre-migration-d1-info\.json/);
  assert.match(infoGuard, /\.running_in_region == "WNAM"/);
});

test("migration runner does not contain adjacent Cloudflare operations or recovery attempts", () => {
  for (const prohibited of [
    /wrangler deploy/,
    /"\$WRANGLER"\s+deploy/,
    /d1 time-travel restore/,
    /d1 delete/,
    /queues create/,
    /queues delete/,
    /secret put/,
    /secret delete/,
  ]) assert.doesNotMatch(runner, prohibited);
  assert.match(runner, /no retry or restore was attempted/);
});
