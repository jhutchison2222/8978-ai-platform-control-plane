#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_PACKET_COMMIT="79bf051947019a0703e6095d71bc3d926612c76b"
readonly EXPECTED_RECONCILED_BASE_COMMIT="5d34fd3eb39b37c5dca6a64afd0469478390a808"
readonly EXPECTED_EXECUTION_COMMIT="${SCHEMA_VERIFICATION_EXECUTION_COMMIT:?SCHEMA_VERIFICATION_EXECUTION_COMMIT is required}"
readonly EXPECTED_ACCOUNT_ID="de5e0273347b0b4c5f8f4e554aa2288f"
readonly EXPECTED_DATABASE_NAME="8978-ai-authority-dev"
readonly EXPECTED_DATABASE_ID="741ade94-8539-4fc8-b6be-24884720dee8"
readonly EXPECTED_PACKET_SHA256="bf95a3168ea30273f428e6a8426a0b16a8d05e8c537587925d990254778b7376"
readonly EXPECTED_MIGRATION_RECORD_SHA256="627dcf833b0ba5db15729e3916c246724f4f90c2919e374a4c3e4faeafaf16f1"
readonly EXPECTED_APPROVAL="VERIFY AUTHORITY SCHEMA READ ONLY ONCE"
readonly MIGRATION_CONFIG="deployment/wrangler.authority-migrations.jsonc"
readonly EVIDENCE_DIR="${SCHEMA_VERIFICATION_EVIDENCE_DIR:?SCHEMA_VERIFICATION_EVIDENCE_DIR is required}"
readonly TEMP_DIR="${RUNNER_TEMP:?RUNNER_TEMP is required}/development-authority-schema-inventory"
readonly OPERATOR_PATH="$TEMP_DIR/whoami.txt"
readonly WRANGLER="./node_modules/.bin/wrangler"

readonly DEFINITIONS_SQL="SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
readonly MIGRATIONS_SQL="SELECT name FROM d1_migrations ORDER BY id"
readonly FOREIGN_KEYS_SQL="PRAGMA foreign_key_list(authority_development_activation_evidence_writes)"
readonly INTEGRITY_SQL="PRAGMA integrity_check"
readonly AUTHORITY_ROWS_SQL="SELECT (SELECT count(*) FROM authority_resources) + (SELECT count(*) FROM authority_limits) + (SELECT count(*) FROM authority_identity_keys) + (SELECT count(*) FROM authority_test_evidence) + (SELECT count(*) FROM authority_rollbacks) + (SELECT count(*) FROM authority_project_knowledge) + (SELECT count(*) FROM authority_owner_keys) + (SELECT count(*) FROM authority_standing_state) + (SELECT count(*) FROM authority_development_activation_evidence_bundles) + (SELECT count(*) FROM authority_development_activation_evidence_writes) AS authority_row_count"

readonly -a EXPECTED_TABLES=(
  "authority_development_activation_evidence_bundles"
  "authority_development_activation_evidence_writes"
  "authority_identity_keys"
  "authority_limits"
  "authority_owner_keys"
  "authority_project_knowledge"
  "authority_resources"
  "authority_rollbacks"
  "authority_standing_state"
  "authority_test_evidence"
  "d1_migrations"
)

readonly -a EXPECTED_INDEXES=(
  "authority_activation_evidence_active_commit"
  "authority_activation_evidence_write_nonce"
  "authority_identity_keys_active_key"
  "authority_limits_active_resource_operation"
  "authority_owner_keys_active_key"
  "authority_project_knowledge_active_scope"
  "authority_resources_active_locator"
  "authority_rollbacks_active_reference"
  "authority_standing_state_active_policy"
  "authority_test_evidence_active_action"
)

readonly -a EXPECTED_MIGRATIONS=(
  "0001_authority_read_model.sql"
  "0002_validation_evidence.sql"
  "0003_governing_project_knowledge.sql"
  "0004_owner_control.sql"
  "0005_development_activation_evidence.sql"
  "0006_development_activation_evidence_writes.sql"
)

mkdir -p "$EVIDENCE_DIR" "$TEMP_DIR"
rm -f "$OPERATOR_PATH"
printf 'workflow_started\n' > "$EVIDENCE_DIR/workflow-status.txt"
: > "$EVIDENCE_DIR/commands-invoked.txt"

cleanup_sensitive_files() {
  rm -f "$OPERATOR_PATH"
}

record_unhandled_error() {
  local status=$?
  trap - ERR
  printf 'Unhandled command failure at line %s (exit %s)\n' "${BASH_LINENO[0]:-unknown}" "$status" \
    >> "$EVIDENCE_DIR/errors.txt"
  printf 'inconclusive\n' > "$EVIDENCE_DIR/workflow-status.txt"
  exit "$status"
}

trap 'record_unhandled_error' ERR
trap 'cleanup_sensitive_files' EXIT

fail() {
  printf '%s\n' "$1" >&2
  printf '%s\n' "$1" >> "$EVIDENCE_DIR/errors.txt"
  printf 'inconclusive\n' > "$EVIDENCE_DIR/workflow-status.txt"
  exit 1
}

canonicalize_json() {
  local source_file="$1"
  local destination_file="$2"
  jq -S -c '.' "$source_file" > "$destination_file"
}

assert_exact_array() {
  local actual_file="$1"
  shift
  local expected_file="$TEMP_DIR/expected-array.json"
  printf '%s\n' "$@" | jq -R -s -c 'split("\n")[:-1]' > "$expected_file"
  cmp -s "$expected_file" "$actual_file" || fail "Observed inventory did not match the exact reviewed order"
}

assert_read_only_sql() {
  local sql="$1"
  if grep -Eiq '\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|UPSERT|MERGE)\b' <<< "$sql"; then
    fail "A reviewed schema command contained mutating SQL"
  fi
  if [[ "$sql" != SELECT\ * && "$sql" != "PRAGMA foreign_key_list(authority_development_activation_evidence_writes)" && "$sql" != "PRAGMA integrity_check" ]]; then
    fail "A reviewed schema command was outside the exact read-only allowlist"
  fi
}

run_query() {
  local query_name="$1"
  local sql="$2"
  local raw_path="$TEMP_DIR/${query_name}.raw.json"
  local evidence_path="$EVIDENCE_DIR/${query_name}.json"

  assert_read_only_sql "$sql"
  printf '%s\n' "$query_name" >> "$EVIDENCE_DIR/commands-invoked.txt"
  "$WRANGLER" d1 execute "$EXPECTED_DATABASE_NAME" --remote --config "$MIGRATION_CONFIG" \
    --command "$sql" --json > "$raw_path"
  canonicalize_json "$raw_path" "$evidence_path"
  jq -e 'type == "array" and length == 1 and .[0].success == true and (. [0].results | type == "array")' \
    "$evidence_path" > /dev/null || fail "Read-only D1 query did not return one successful result set"
}

[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || fail "CLOUDFLARE_API_TOKEN is unavailable"
[[ "${CLOUDFLARE_ACCOUNT_ID:-}" == "$EXPECTED_ACCOUNT_ID" ]] || fail "Selected account does not match the authorized development account"
[[ "${SCHEMA_VERIFICATION_APPROVAL:-}" == "$EXPECTED_APPROVAL" ]] || fail "Exact owner approval phrase is unavailable"
[[ "${GITHUB_ACTOR:-}" == "jhutchison2222" ]] || fail "Schema verification operator is not the repository owner"
[[ "$(git rev-parse HEAD)" == "$EXPECTED_EXECUTION_COMMIT" ]] || fail "Checked-out runtime does not match the reviewed execution commit"
git merge-base --is-ancestor "$EXPECTED_PACKET_COMMIT" "$EXPECTED_EXECUTION_COMMIT" || fail "Reviewed schema packet commit is not an ancestor of the execution commit"
git merge-base --is-ancestor "$EXPECTED_RECONCILED_BASE_COMMIT" "$EXPECTED_EXECUTION_COMMIT" || fail "Accepted schema reconciliation commit is not an ancestor of the execution commit"
git diff --quiet "$EXPECTED_RECONCILED_BASE_COMMIT" "$EXPECTED_EXECUTION_COMMIT" -- \
  deployment/development-authority-schema-inventory-verification-packet.json \
  deployment/development-authority-migration-execution-record.json \
  deployment/wrangler.authority-migrations.jsonc \
  migrations/authority \
  schemas/development-authority-schema-inventory-verification-record.schema.json \
  src/development-authority-schema-inventory-verification-record.js \
  || fail "Accepted reconciled packet, migration evidence, schema, validator, configuration, or SQL drifted"

[[ "$(sha256sum deployment/development-authority-schema-inventory-verification-packet.json | cut -d' ' -f1)" == "$EXPECTED_PACKET_SHA256" ]] || fail "Schema inventory packet digest drifted"
[[ "$(sha256sum deployment/development-authority-migration-execution-record.json | cut -d' ' -f1)" == "$EXPECTED_MIGRATION_RECORD_SHA256" ]] || fail "Accepted migration execution record digest drifted"

"$WRANGLER" --version > "$EVIDENCE_DIR/wrangler-version.txt"
"$WRANGLER" whoami > "$OPERATOR_PATH" 2>&1
grep -Fq "$EXPECTED_ACCOUNT_ID" "$OPERATOR_PATH" || fail "Authenticated Wrangler identity did not report the authorized account"
jq -n --arg accountId "$EXPECTED_ACCOUNT_ID" --arg principalId "github:${GITHUB_ACTOR}" \
  '{accountId:$accountId,principalId:$principalId,authenticated:true}' > "$EVIDENCE_DIR/operator-summary.json"

printf '1\n' > "$EVIDENCE_DIR/attempt-count.txt"
printf 'databaseInfo\n' >> "$EVIDENCE_DIR/commands-invoked.txt"
"$WRANGLER" d1 info "$EXPECTED_DATABASE_NAME" --json > "$TEMP_DIR/databaseInfo.raw.json"
canonicalize_json "$TEMP_DIR/databaseInfo.raw.json" "$EVIDENCE_DIR/databaseInfo.json"
jq -e \
  --arg name "$EXPECTED_DATABASE_NAME" \
  --arg uuid "$EXPECTED_DATABASE_ID" \
  '.name == $name and .uuid == $uuid and .running_in_region == "WNAM" and
   .jurisdiction == null and .version == "production" and .num_tables == 11' \
  "$EVIDENCE_DIR/databaseInfo.json" > /dev/null || fail "D1 identity, placement, version, or table count differed"

run_query definitions "$DEFINITIONS_SQL"
jq -c '[.[0].results[] | select(.type == "table" and .name != "_cf_KV") | .name] | sort' \
  "$EVIDENCE_DIR/definitions.json" > "$EVIDENCE_DIR/observed-tables.json"
jq -c '[.[0].results[] | select(.type == "index") | .name] | sort' \
  "$EVIDENCE_DIR/definitions.json" > "$EVIDENCE_DIR/observed-indexes.json"
assert_exact_array "$EVIDENCE_DIR/observed-tables.json" "${EXPECTED_TABLES[@]}"
assert_exact_array "$EVIDENCE_DIR/observed-indexes.json" "${EXPECTED_INDEXES[@]}"

run_query appliedMigrations "$MIGRATIONS_SQL"
jq -c '[.[0].results[].name]' "$EVIDENCE_DIR/appliedMigrations.json" > "$EVIDENCE_DIR/observed-migrations.json"
assert_exact_array "$EVIDENCE_DIR/observed-migrations.json" "${EXPECTED_MIGRATIONS[@]}"

run_query foreignKeys "$FOREIGN_KEYS_SQL"
jq -e \
  '.[0].results | length == 1 and
   .[0].table == "authority_development_activation_evidence_bundles" and
   .[0].from == "record_id" and .[0].to == "record_id" and
   .[0].on_update == "RESTRICT" and .[0].on_delete == "RESTRICT"' \
  "$EVIDENCE_DIR/foreignKeys.json" > /dev/null || fail "Reviewed evidence-write foreign key differed"

run_query integrity "$INTEGRITY_SQL"
jq -e '.[0].results | length == 1 and .[0].integrity_check == "ok"' \
  "$EVIDENCE_DIR/integrity.json" > /dev/null || fail "D1 integrity check did not return exactly ok"

run_query authorityRows "$AUTHORITY_ROWS_SQL"
jq -e '.[0].results | length == 1 and .[0].authority_row_count == 0' \
  "$EVIDENCE_DIR/authorityRows.json" > /dev/null || fail "One or more authority tables contained data"

readonly AUTHORIZATION_SHA256="$(printf '%s' "$EXPECTED_APPROVAL" | sha256sum | cut -d' ' -f1)"
readonly DEFINITIONS_SHA256="$(sha256sum "$EVIDENCE_DIR/definitions.json" | cut -d' ' -f1)"

query_digest_args=()
for query_name in databaseInfo definitions appliedMigrations foreignKeys integrity authorityRows; do
  query_digest_args+=(--arg "${query_name}Sha256" "$(sha256sum "$EVIDENCE_DIR/${query_name}.json" | cut -d' ' -f1)")
done

jq -n \
  --arg recordedAt "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg ownerDecisionId "github-workflow-dispatch-${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}" \
  --arg ownerAuthorizationDigest "sha256:$AUTHORIZATION_SHA256" \
  --arg operatorPrincipalId "github:${GITHUB_ACTOR}" \
  --arg accountId "$EXPECTED_ACCOUNT_ID" \
  --arg packetCommit "$EXPECTED_PACKET_COMMIT" \
  --arg packetSha256 "$EXPECTED_PACKET_SHA256" \
  --arg migrationRecordSha256 "$EXPECTED_MIGRATION_RECORD_SHA256" \
  --arg definitionsSha256 "$DEFINITIONS_SHA256" \
  "${query_digest_args[@]}" \
  --slurpfile database "$EVIDENCE_DIR/databaseInfo.json" \
  --slurpfile tables "$EVIDENCE_DIR/observed-tables.json" \
  --slurpfile indexes "$EVIDENCE_DIR/observed-indexes.json" \
  --slurpfile migrations "$EVIDENCE_DIR/observed-migrations.json" \
  --slurpfile foreignKeys "$EVIDENCE_DIR/foreignKeys.json" \
  --slurpfile integrity "$EVIDENCE_DIR/integrity.json" \
  --slurpfile authorityRows "$EVIDENCE_DIR/authorityRows.json" \
  '{
    schemaVersion:"1.0.0", status:"INCONCLUSIVE_READ_ONLY", governing:false, environment:"development",
    source:{reviewedCommit:$packetCommit,packetPath:"deployment/development-authority-schema-inventory-verification-packet.json",packetSha256:$packetSha256,authorizedAccountId:$accountId},
    authorization:{ownerDecisionId:$ownerDecisionId,ownerAuthorizationDigest:$ownerAuthorizationDigest,accountId:$accountId,readOnlyVerificationAuthorized:true,authorizedAttemptLimit:1},
    operator:{principalId:$operatorPrincipalId,authenticatedAccountId:$accountId},
    prerequisite:{executionRecordPath:"deployment/development-authority-migration-execution-record.json",executionRecordSha256:$migrationRecordSha256,status:"COMPLETED",independentlyAccepted:true},
    execution:{attemptCount:1,invoked:true,commandsInvoked:["databaseInfo","definitions","appliedMigrations","foreignKeys","integrity","authorityRows"],outcome:"SUCCEEDED"},
    evidence:{queryResultSha256:{databaseInfo:$databaseInfoSha256,definitions:$definitionsSha256,appliedMigrations:$appliedMigrationsSha256,foreignKeys:$foreignKeysSha256,integrity:$integritySha256,authorityRows:$authorityRowsSha256}},
    observations:{
      database:{retrieved:true,name:$database[0].name,databaseId:$database[0].uuid,region:$database[0].running_in_region,jurisdiction:$database[0].jurisdiction,version:$database[0].version,identityMatched:true},
      definitions:{retrieved:true,tables:$tables[0],indexes:$indexes[0],definitionsSha256:$definitionsSha256},
      migrations:{retrieved:true,names:$migrations[0]},
      foreignKey:{retrieved:true,fromTable:"authority_development_activation_evidence_writes",toTable:$foreignKeys[0][0].results[0].table,fromColumn:$foreignKeys[0][0].results[0].from,toColumn:$foreignKeys[0][0].results[0].to,onUpdate:$foreignKeys[0][0].results[0].on_update,onDelete:$foreignKeys[0][0].results[0].on_delete,matched:true},
      integrity:{retrieved:true,result:$integrity[0][0].results[0].integrity_check},
      authorityData:{retrieved:true,rowCount:$authorityRows[0][0].results[0].authority_row_count}
    },
    independentReview:{completed:false,checkerPrincipalId:null,checkerDigest:null,accepted:false},
    conclusions:{inventoryVerified:false,definitionsVerified:false,foreignKeysVerified:false,integrityVerified:false,emptyAuthorityDataVerified:false,remoteSchemaVerified:false,activationPlanUpdateAuthorized:false,activationPlanUpdated:false},
    externalEffects:{mutatingSqlExecuted:false,migrationAppliedOrCreated:false,runtimeBindingInstalled:false,workerCreatedOrDeployed:false,workflowCreatedOrTriggered:false,queueConnectedOrPublished:false,secretOrKeyChanged:false,authorityDataWritten:false,projectKnowledgeSeeded:false,activationEvidenceWritten:false,deploymentActivated:false,productionOrCustomerResourceTouched:false},
    failurePolicy:{restoreAttempted:false,retryAttempted:false,cleanupAttempted:false,deletionAttempted:false},
    errors:["Independent definition-level review remains pending"],recordedAt:$recordedAt
  }' > "$EVIDENCE_DIR/candidate-verification-record.json"

node --input-type=module - "$EVIDENCE_DIR/candidate-verification-record.json" <<'NODE'
import { readFile } from "node:fs/promises";
import { parseJsonStrict } from "./src/canonical-digest.js";
import { assertDevelopmentAuthoritySchemaInventoryVerificationRecord } from "./src/development-authority-schema-inventory-verification-record.js";

const recordPath = process.argv[2];
const schema = parseJsonStrict(await readFile("schemas/development-authority-schema-inventory-verification-record.schema.json", "utf8"));
const record = parseJsonStrict(await readFile(recordPath, "utf8"));
assertDevelopmentAuthoritySchemaInventoryVerificationRecord(schema, record);
NODE

printf 'succeeded_pending_independent_review\n' > "$EVIDENCE_DIR/workflow-status.txt"
