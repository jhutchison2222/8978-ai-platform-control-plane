import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { localBoundaryViolations } from "../scripts/autonomy-watchdog.js";

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
    "the supervisor requests a prohibited write permission",
    "the supervisor is missing required permission contents: read",
    "the watchdog workflow references a Workspace Agent credential",
  ]);
});
