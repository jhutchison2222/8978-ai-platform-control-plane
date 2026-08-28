import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runner = await readFile("scripts/run-development-authority-schema-inventory-verification.sh", "utf8");

test("schema inventory runner pins the accepted packet, migration record, account, and database", () => {
  for (const literal of [
    "295606daa8caca8b998290b959184c131eed0fb0",
    "008a0bb5d4a2613e71e50b5ab058adaa616a2399",
    "86f8b5e82beef8a51f09b69f5eb02964237014a00d204d69c52a35db53d287de",
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
  const databaseInfoWithoutVersion = {
    jurisdiction: null,
    name: "synthetic-d1",
    num_tables: 11,
    running_in_region: "WNAM",
    uuid: "synthetic-uuid",
  };
  const filter = [
    '.name == $name and .uuid == $uuid and .running_in_region == "WNAM" and',
    '.jurisdiction == null and ((has("version") | not) or .version == "production") and .num_tables == 11',
  ].join(" ");
  const args = [
    "-e", "--arg", "name", databaseInfoWithoutVersion.name, "--arg", "uuid",
    databaseInfoWithoutVersion.uuid, filter,
  ];

  assert.equal(spawnSync("jq", args, { input: JSON.stringify(databaseInfoWithoutVersion) }).status, 0);
  assert.notEqual(spawnSync("jq", args, {
    input: JSON.stringify({ ...databaseInfoWithoutVersion, version: "legacy" }),
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
  assert.match(runner, /INTEGRITY_SQL="PRAGMA quick_check"/);
  assert.match(runner, /keys == \["quick_check"\] and \.quick_check == "ok"/);
  assert.doesNotMatch(runner, /\.integrity_check/);
  assert.doesNotMatch(runner, /PRAGMA integrity_check/);
});

test("schema inventory runner accepts only the observed D1 quick-check result shape", () => {
  const filter = '.[0].results | length == 1 and ' +
    '(.[0] | type == "object" and keys == ["quick_check"] and .quick_check == "ok")';
  const runFilter = (results) => spawnSync("jq", ["-e", filter], {
    input: JSON.stringify([{ success: true, results }]),
  }).status;

  assert.equal(runFilter([{ quick_check: "ok" }]), 0);
  assert.notEqual(runFilter([{ integrity_check: "ok" }]), 0);
  assert.notEqual(runFilter([{ quick_check: "corrupt" }]), 0);
  assert.notEqual(runFilter([{ quick_check: "ok", unexpected: true }]), 0);
  assert.notEqual(runFilter([{ quick_check: "ok" }, { quick_check: "ok" }]), 0);
  assert.notEqual(runFilter([]), 0);
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
