#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_BASELINE_COMMIT="727d34322b9e725c482cd041d1d9405772737af3"
readonly EXPECTED_EXECUTION_COMMIT="${MIGRATION_EXECUTION_COMMIT:?MIGRATION_EXECUTION_COMMIT is required}"
readonly EXPECTED_ACCOUNT_ID="de5e0273347b0b4c5f8f4e554aa2288f"
readonly EXPECTED_DATABASE_NAME="8978-ai-authority-dev"
readonly EXPECTED_DATABASE_ID="741ade94-8539-4fc8-b6be-24884720dee8"
readonly EXPECTED_PACKET_SHA256="ab865340c48279e6e5654e8e6b0ed52cb9d4af28115c49b47d787ad1ec205d8a"
readonly MIGRATION_CONFIG="deployment/wrangler.authority-migrations.jsonc"
readonly EVIDENCE_DIR="${MIGRATION_EVIDENCE_DIR:?MIGRATION_EVIDENCE_DIR is required}"
readonly BACKUP_PATH="${RUNNER_TEMP:?RUNNER_TEMP is required}/8978-ai-authority-dev-pre-migration.sql"
readonly OPERATOR_PATH="${RUNNER_TEMP}/development-authority-whoami.txt"
readonly D1_LIST_PATH="${RUNNER_TEMP}/development-authority-d1-list.json"
readonly D1_LIST_ERROR_PATH="${RUNNER_TEMP}/development-authority-d1-list.stderr"
readonly WRANGLER="./node_modules/.bin/wrangler"

readonly -a EXPECTED_MIGRATIONS=(
  "0001_authority_read_model.sql"
  "0002_validation_evidence.sql"
  "0003_governing_project_knowledge.sql"
  "0004_owner_control.sql"
  "0005_development_activation_evidence.sql"
  "0006_development_activation_evidence_writes.sql"
)

mkdir -p "$EVIDENCE_DIR"
rm -f "$BACKUP_PATH" "$OPERATOR_PATH" "$D1_LIST_PATH" "$D1_LIST_ERROR_PATH"

cleanup_sensitive_files() {
  rm -f "$BACKUP_PATH" "$OPERATOR_PATH" "$D1_LIST_PATH" "$D1_LIST_ERROR_PATH"
}

record_unhandled_error() {
  local status=$?
  trap - ERR
  printf 'Unhandled command failure at line %s (exit %s)\n' "${BASH_LINENO[0]:-unknown}" "$status" \
    >> "$EVIDENCE_DIR/errors.txt"
  exit "$status"
}

trap 'record_unhandled_error' ERR
trap 'cleanup_sensitive_files' EXIT

fail() {
  printf '%s\n' "$1" >&2
  printf '%s\n' "$1" >> "$EVIDENCE_DIR/errors.txt"
  exit 1
}

capture_migration_names() {
  local source_file="$1"
  local destination_file="$2"
  grep -oE '000[1-6]_[a-z0-9_]+\.sql' "$source_file" | awk '!seen[$0]++' > "$destination_file" || true
}

assert_exact_migration_list() {
  local actual_file="$1"
  local expected_file="$EVIDENCE_DIR/expected-migrations.txt"
  printf '%s\n' "${EXPECTED_MIGRATIONS[@]}" > "$expected_file"
  cmp -s "$expected_file" "$actual_file" || fail "Pending migration list did not match the exact reviewed order"
}

[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || fail "CLOUDFLARE_API_TOKEN is unavailable"
[[ "${CLOUDFLARE_ACCOUNT_ID:-}" == "$EXPECTED_ACCOUNT_ID" ]] || fail "Authenticated account selection does not match the authorized account"
[[ "$(git rev-parse HEAD)" == "$EXPECTED_EXECUTION_COMMIT" ]] || fail "Checked-out runtime does not match the reviewed execution commit"
git merge-base --is-ancestor "$EXPECTED_BASELINE_COMMIT" "$EXPECTED_EXECUTION_COMMIT" || fail "Reviewed migration baseline is not an ancestor of the execution commit"
git diff --quiet "$EXPECTED_BASELINE_COMMIT" "$EXPECTED_EXECUTION_COMMIT" -- \
  deployment/development-authority-migration-execution-packet.json \
  deployment/wrangler.authority-migrations.jsonc \
  migrations/authority \
  || fail "Reviewed migration packet, configuration, or SQL changed after the pinned source commit"
[[ "$(sha256sum deployment/development-authority-migration-execution-packet.json | cut -d' ' -f1)" == "$EXPECTED_PACKET_SHA256" ]] || fail "Migration execution packet digest drifted"

sha256sum -c <<'DIGESTS' > "$EVIDENCE_DIR/digest-verification.txt"
7d028839586d0009ff88ec172da85efaa0bb1e05b43644af65f37dd1cd7fbd26  deployment/wrangler.authority-migrations.jsonc
fded8c2fe248ecd7cfbb1214d0449f012b7099220f85e80fcd3012b3b9ade424  migrations/authority/0001_authority_read_model.sql
75e03891d1b93baf4d10bb0d248b9779405b31f78458f6874e629c320ed5b4b9  migrations/authority/0002_validation_evidence.sql
8383c73014a72d30fd179628b0ff8411bf0ab27572585a281279227d03fb3c7a  migrations/authority/0003_governing_project_knowledge.sql
4f7d4cb7939eefb8e6c2f7f292c7e806399b3366e135d775fa317214d7f67185  migrations/authority/0004_owner_control.sql
4f75b03549ab1df797fb73a87768291caf921a22f796939c7b466eea3eb528c3  migrations/authority/0005_development_activation_evidence.sql
0bf3e2dbdd935fe6c2ecbd310d8c465e2bca845569a0d10e52e0ac563a181eb4  migrations/authority/0006_development_activation_evidence_writes.sql
DIGESTS

"$WRANGLER" --version > "$EVIDENCE_DIR/wrangler-version.txt"
"$WRANGLER" whoami > "$OPERATOR_PATH" 2>&1
grep -Fq "$EXPECTED_ACCOUNT_ID" "$OPERATOR_PATH" || fail "Authenticated Wrangler identity did not report the authorized account"
jq -n --arg accountId "$EXPECTED_ACCOUNT_ID" \
  '{accountId:$accountId, authenticated:true}' > "$EVIDENCE_DIR/operator-summary.json"

"$WRANGLER" d1 list --json > "$D1_LIST_PATH" 2> "$D1_LIST_ERROR_PATH"
jq -e \
  --arg name "$EXPECTED_DATABASE_NAME" \
  '[.[] | select(.name == $name)] |
   if length == 1 then .[0] else error("Expected exactly one target D1 database") end' \
  "$D1_LIST_PATH" > "$EVIDENCE_DIR/pre-migration-d1-target.json"
"$WRANGLER" d1 info "$EXPECTED_DATABASE_NAME" --json > "$EVIDENCE_DIR/pre-migration-d1-info.json"

jq -e \
  --arg name "$EXPECTED_DATABASE_NAME" \
  --arg uuid "$EXPECTED_DATABASE_ID" \
  '.name == $name and .uuid == $uuid and
   .running_in_region == "WNAM" and .jurisdiction == null and
   .version == "production" and .num_tables == 0' \
  "$EVIDENCE_DIR/pre-migration-d1-target.json" > /dev/null || fail "Pre-migration D1 identity, placement, version, or empty-state verification failed"

jq -e \
  --arg name "$EXPECTED_DATABASE_NAME" \
  --arg uuid "$EXPECTED_DATABASE_ID" \
  '.name == $name and .uuid == $uuid and .running_in_region == "WNAM" and
   .jurisdiction == null and .num_tables == 0 and
   (.database_size | type == "number" and . >= 0)' \
  "$EVIDENCE_DIR/pre-migration-d1-info.json" > /dev/null || fail "Pre-migration D1 identity or empty-state verification failed"

"$WRANGLER" d1 time-travel info "$EXPECTED_DATABASE_NAME" --json > "$EVIDENCE_DIR/time-travel.json"
jq -e '.bookmark | type == "string" and length > 0' "$EVIDENCE_DIR/time-travel.json" > /dev/null || fail "Time Travel bookmark was unavailable"

"$WRANGLER" d1 export "$EXPECTED_DATABASE_NAME" --remote --skip-confirmation --output "$BACKUP_PATH" \
  > "$EVIDENCE_DIR/export-command.txt" 2>&1
[[ -s "$BACKUP_PATH" ]] || fail "Pre-migration SQL export was not created"
sha256sum "$BACKUP_PATH" | cut -d' ' -f1 > "$EVIDENCE_DIR/export-sha256.txt"
stat --format='%s' "$BACKUP_PATH" > "$EVIDENCE_DIR/export-size-bytes.txt"

"$WRANGLER" d1 migrations list "$EXPECTED_DATABASE_NAME" --remote --config "$MIGRATION_CONFIG" \
  > "$EVIDENCE_DIR/pending-before.txt" 2>&1
capture_migration_names "$EVIDENCE_DIR/pending-before.txt" "$EVIDENCE_DIR/pending-before-migrations.txt"
assert_exact_migration_list "$EVIDENCE_DIR/pending-before-migrations.txt"

printf '1\n' > "$EVIDENCE_DIR/attempt-count.txt"
set +e
"$WRANGLER" d1 migrations apply "$EXPECTED_DATABASE_NAME" --remote --config "$MIGRATION_CONFIG" \
  > "$EVIDENCE_DIR/apply-result.txt" 2>&1
apply_status=$?
set -e
if [[ "$apply_status" -ne 0 ]]; then
  "$WRANGLER" d1 migrations list "$EXPECTED_DATABASE_NAME" --remote --config "$MIGRATION_CONFIG" \
    > "$EVIDENCE_DIR/pending-after-failed-apply.txt" 2>&1 || true
  "$WRANGLER" d1 info "$EXPECTED_DATABASE_NAME" --json \
    > "$EVIDENCE_DIR/post-failed-apply-d1-info.json" 2>&1 || true
  fail "The single migration application attempt failed; no retry or restore was attempted"
fi
capture_migration_names "$EVIDENCE_DIR/apply-result.txt" "$EVIDENCE_DIR/applied-migrations.txt"
assert_exact_migration_list "$EVIDENCE_DIR/applied-migrations.txt"

"$WRANGLER" d1 migrations list "$EXPECTED_DATABASE_NAME" --remote --config "$MIGRATION_CONFIG" \
  > "$EVIDENCE_DIR/pending-after.txt" 2>&1
capture_migration_names "$EVIDENCE_DIR/pending-after.txt" "$EVIDENCE_DIR/pending-after-migrations.txt"
[[ ! -s "$EVIDENCE_DIR/pending-after-migrations.txt" ]] || fail "One or more migrations remained pending after the single application attempt"

"$WRANGLER" d1 info "$EXPECTED_DATABASE_NAME" --json > "$EVIDENCE_DIR/post-migration-d1-info.json"
jq -e \
  --arg name "$EXPECTED_DATABASE_NAME" \
  --arg uuid "$EXPECTED_DATABASE_ID" \
  '.name == $name and .uuid == $uuid and .running_in_region == "WNAM" and
   .jurisdiction == null and .num_tables == 11 and
   (.database_size | type == "number" and . > 0)' \
  "$EVIDENCE_DIR/post-migration-d1-info.json" > /dev/null || fail "Post-migration D1 metadata or table-count verification failed"

jq -n \
  --arg recordedAt "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg reviewedCommit "$EXPECTED_BASELINE_COMMIT" \
  --arg executionCommit "$EXPECTED_EXECUTION_COMMIT" \
  --arg packetSha256 "$EXPECTED_PACKET_SHA256" \
  --arg accountId "$EXPECTED_ACCOUNT_ID" \
  --arg databaseId "$EXPECTED_DATABASE_ID" \
  --arg bookmark "$(jq -r '.bookmark' "$EVIDENCE_DIR/time-travel.json")" \
  --arg exportSha256 "$(< "$EVIDENCE_DIR/export-sha256.txt")" \
  --argjson exportSizeBytes "$(< "$EVIDENCE_DIR/export-size-bytes.txt")" \
  '{recordedAt:$recordedAt, reviewedCommit:$reviewedCommit, executionCommit:$executionCommit, packetSha256:$packetSha256,
    accountId:$accountId, databaseId:$databaseId, bookmark:$bookmark,
    exportSha256:$exportSha256, exportSizeBytes:$exportSizeBytes,
    migrationAttemptCount:1, migrationOutcome:"SUCCEEDED", sqlExportRetained:false,
    runtimeBindingInstalled:false, workerCreatedOrDeployed:false,
    workflowCreatedOrTriggered:false, queueConnectedOrPublished:false,
    authorityDataWritten:false, projectKnowledgeSeeded:false,
    activationEvidenceWritten:false, activationPlanUpdated:false,
    deploymentActivated:false, restoreAttempted:false, retryAttempted:false,
    cleanupAttempted:false, deletionAttempted:false,
    productionOrCustomerResourceTouched:false}' \
  > "$EVIDENCE_DIR/execution-summary.json"
