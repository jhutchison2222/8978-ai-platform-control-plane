import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runner = await readFile("scripts/run-development-authority-schema-inventory-verification.sh", "utf8");
const observedDatabaseInfo = JSON.parse(await readFile(
  "test/fixtures/development-authority-database-info-wrangler-4.122.0.json",
  "utf8",
));

test("schema inventory runner pins the accepted packet, migration record, account, and database", () => {
  for (const literal of [
    "79bf051947019a0703e6095d71bc3d926612c76b",
    "8fa30ed4414c9d0cbb6361ff2939f1303eef55aa",
    "bf95a3168ea30273f428e6a8426a0b16a8d05e8c537587925d990254778b7376",
    "627dcf833b0ba5db15729e3916c246724f4f90c2919e374a4c3e4faeafaf16f1",
    "de5e0273347b0b4c5f8f4e554aa2288f",
    "8978-ai-authority-dev",
    "741ade94-8539-4fc8-b6be-24884720dee8",
    "VERIFY AUTHORITY SCHEMA READ ONLY ONCE",
  ]) assert.match(runner, new RegExp(literal));

  assert.match(runner, /SCHEMA_VERIFICATION_EXECUTION_COMMIT/);
  assert.match(runner, /git merge-base --is-ancestor/);
  assert.match(runner, /git merge-base --is-ancestor "\$EXPECTED_RECONCILED_BASE_COMMIT" "\$EXPECTED_EXECUTION_COMMIT"/);
  assert.match(runner, /git diff --quiet "\$EXPECTED_RECONCILED_BASE_COMMIT" "\$EXPECTED_EXECUTION_COMMIT"/);
  assert.doesNotMatch(runner, /git diff --quiet "\$EXPECTED_PACKET_COMMIT"/);
  assert.match(runner, /Authenticated Wrangler identity did not report the authorized account/);
});

test("schema inventory runner accepts Wrangler 4.122.0 omitting version and rejects a reported wrong version", () => {
  const filter = [
    '.name == $name and .uuid == $uuid and .running_in_region == "WNAM" and',
    '.jurisdiction == null and ((has("version") | not) or .version == "production") and .num_tables == 11',
  ].join(" ");
  const args = [
    "-e", "--arg", "name", "8978-ai-authority-dev", "--arg", "uuid",
    "741ade94-8539-4fc8-b6be-24884720dee8", filter,
  ];

  assert.equal(spawnSync("jq", args, { input: JSON.stringify(observedDatabaseInfo) }).status, 0);
  assert.notEqual(spawnSync("jq", args, {
    input: JSON.stringify({ ...observedDatabaseInfo, version: "legacy" }),
  }).status, 0);
  assert.match(runner, /\(\(has\("version"\) \| not\) or \.version == "production"\)/);
});

test("schema inventory runner invokes exactly the six reviewed read-only observations", () => {
  assert.equal((runner.match(/run_query definitions /g) ?? []).length, 1);
  assert.equal((runner.match(/run_query appliedMigrations /g) ?? []).length, 1);
  assert.equal((runner.match(/run_query foreignKeys /g) ?? []).length, 1);
  assert.equal((runner.match(/run_query integrity /g) ?? []).length, 1);
  assert.equal((runner.match(/run_query authorityRows /g) ?? []).length, 1);
  assert.equal((runner.match(/d1 info "\$EXPECTED_DATABASE_NAME" --json/g) ?? []).length, 1);
  assert.match(runner, /assert_read_only_sql/);
  assert.match(runner, /A reviewed schema command contained mutating SQL/);
  assert.match(runner, /commands-invoked\.txt/);
  assert.match(runner, /attempt-count\.txt/);
});

test("schema inventory runner fails closed without adjacent operations or retries", () => {
  for (const prohibited of [
    /d1 migrations (?:apply|create)/,
    /d1 time-travel restore/,
    /d1 export/,
    /wrangler deploy/,
    /"\$WRANGLER"\s+deploy/,
    /queues (?:create|delete|consumer)/,
    /workflows (?:trigger|delete)/,
    /secret (?:put|delete)/,
    /d1 delete/,
    /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\s+(?:INTO|FROM|TABLE|INDEX)/i,
  ]) assert.doesNotMatch(runner, prohibited);

  assert.doesNotMatch(runner, /\b(?:for|while|until)\b[^\n]*retry/i);
  assert.match(runner, /trap 'record_unhandled_error' ERR/);
  assert.match(runner, /trap 'cleanup_sensitive_files' EXIT/);
  assert.match(runner, /INCONCLUSIVE_READ_ONLY/);
  assert.match(runner, /Independent definition-level review remains pending/);
  assert.match(runner, /assertDevelopmentAuthoritySchemaInventoryVerificationRecord/);
});
