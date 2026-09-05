import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isRestrictedForkSecurityStopFailure,
  localBoundaryViolations,
  topLevelPermissions,
} from "../scripts/autonomy-watchdog.js";

test("watchdog workflow is isolated from Workspace Agent credentials and dispatch", async () => {
  const workflow = await readFile(".github/workflows/autonomy-watchdog.yml", "utf8");
  for (const required of [
    "group: autonomy-control",
    "contents: read",
    "issues: write",
    "pull-requests: read",
    "node scripts/autonomy-watchdog.js",
  ]) assert.equal(workflow.includes(required), true);
  assert.doesNotMatch(workflow, /CHATGPT_WORKSPACE_AGENT|AGENT_TOKEN|api\.chatgpt\.com|pull-requests:\s*write|contents:\s*write/iu);
});

test("watchdog accepts the checked-in least-privilege boundary", async () => {
  const [supervisorWorkflow, watchdogWorkflow] = await Promise.all([
    readFile(".github/workflows/autonomy-supervisor.yml", "utf8"),
    readFile(".github/workflows/autonomy-watchdog.yml", "utf8"),
  ]);
  assert.deepEqual(localBoundaryViolations({ supervisorWorkflow, watchdogWorkflow }), []);
});

test("watchdog detects permission expansion and credential coupling", () => {
  const supervisorWorkflow = `actions: read\nchecks: read\ncontents: write\nissues: write\npull-requests: write`;
  const watchdogWorkflow = `contents: read\nissues: write\npull-requests: read\nAGENT_TOKEN: secret`;
  assert.deepEqual(localBoundaryViolations({ supervisorWorkflow, watchdogWorkflow }), [
    "the supervisor permissions do not exactly match the reviewed allowlist",
    "the watchdog permissions do not exactly match the reviewed allowlist",
    "the watchdog workflow references a Workspace Agent credential",
  ]);
});

test("permission parsing cannot be satisfied by comments or job-level text", () => {
  const workflow = `# permissions:\n#   contents: read\njobs:\n  test:\n    permissions:\n      contents: read`;
  assert.equal(topLevelPermissions(workflow), null);
  const expanded = `permissions:\n  contents: read\n  issues: write\n  pull-requests: read\n  deployments: write`;
  assert.deepEqual(localBoundaryViolations({
    supervisorWorkflow: `permissions:\n  actions: read\n  checks: read\n  contents: read\n  issues: write\n  pull-requests: write`,
    watchdogWorkflow: expanded,
  }), ["the watchdog permissions do not exactly match the reviewed allowlist"]);
});


test("only a fork pull-request read-only token defers stop creation to the schedule", () => {
  const error = Object.assign(new Error("forbidden"), { status: 403 });
  const input = {
    error,
    eventName: "pull_request",
    headRepository: "external/fork",
    repository: "owner/repo",
  };
  assert.equal(isRestrictedForkSecurityStopFailure(input), true);
  assert.equal(isRestrictedForkSecurityStopFailure({ ...input, eventName: "schedule" }), false);
  assert.equal(isRestrictedForkSecurityStopFailure({ ...input, headRepository: "owner/repo" }), false);
  assert.equal(isRestrictedForkSecurityStopFailure({ ...input, error: Object.assign(new Error("server"), { status: 500 }) }), false);
});
