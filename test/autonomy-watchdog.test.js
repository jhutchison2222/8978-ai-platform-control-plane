import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isRestrictedForkSecurityStopFailure,
  runWatchdog,
  localBoundaryViolations,
  topLevelPermissions,
} from "../scripts/autonomy-watchdog.js";
import { runSupervisor } from "../scripts/autonomy-supervisor.js";

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

test("fork pull-request events skip label writes before evaluating the boundary", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, method: options.method ?? "GET" });
    if ((options.method ?? "GET") !== "GET") {
      return { ok: false, status: 403, json: async () => ({ message: "Resource not accessible by integration" }) };
    }
    if (url.includes("/pulls?state=open")) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes("/issues?state=all&labels=")) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.endsWith("/issues/66")) {
      return { ok: true, status: 200, json: async () => ({
        number: 66,
        state: "closed",
        closed_by: { login: "owner" },
        labels: [],
      }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const reasons = await runWatchdog({
    repository: "owner/repo",
    githubToken: "token",
    eventName: "pull_request",
    headRepository: "external/fork",
    fetchImpl,
  });

  assert.deepEqual(reasons, []);
  assert.equal(requests.some(({ url }) => url.includes("/labels")), false);
  assert.equal(requests.every(({ method }) => method === "GET"), true);
});

test("the supervisor and the watchdog compute identical #66 reasons, so alternating runs converge instead of oscillating the body forever", async () => {
  // Before this fix, runSupervisor fed ensureSecurityStop only securityStopReasons(), while
  // runWatchdog fed it localBoundaryViolations() + securityStopReasons(). Whenever a boundary
  // violation was present, each scheduler would overwrite #66's body with its own differing text on
  // every run, forever, and silently discard any note the owner had added to the body in between.
  const requiredLabels = [
    { name: "autonomy-ready" }, { name: "autonomy-dispatched", description: "Autonomous agent dispatch accepted" },
    { name: "autonomy-parallel" }, { name: "autonomy-blocked" }, { name: "security-review" },
    { name: "major-decision" }, { name: "autonomy-security-stop" },
  ];
  const supervisorWorkflow = [
    "permissions:",
    "  actions: read",
    "  checks: read",
    "  contents: read",
    "  issues: write",
    "  pull-requests: write",
  ].join("\n");
  // A mismatched watchdog boundary (an extra permission) is the one and only reason this fixture
  // produces, and only localBoundaryViolations() detects it — proving both callers now see it.
  const watchdogWorkflow = [
    "permissions:",
    "  contents: read",
    "  issues: write",
    "  pull-requests: read",
    "  deployments: write",
  ].join("\n");
  let issue66 = { number: 66, state: "closed", closed_by: { login: "owner" }, labels: [] };
  const patches = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? "GET";
    if (method === "GET" && url.includes("/labels?")) {
      return { ok: true, status: 200, json: async () => requiredLabels };
    }
    if (method === "GET" && url.includes("/pulls?state=open")) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (method === "GET" && url.endsWith("/issues/66")) {
      return { ok: true, status: 200, json: async () => issue66 };
    }
    if (method === "GET" && url.includes("/issues?state=all&labels=")) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (method === "PATCH" && url.endsWith("/issues/66")) {
      const body = JSON.parse(options.body);
      patches.push(body);
      issue66 = {
        ...issue66,
        ...body,
        labels: body.labels ? body.labels.map((name) => ({ name })) : issue66.labels,
      };
      return { ok: true, status: 200, json: async () => issue66 };
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const readFileImpl = async (path) => (path.includes("watchdog") ? watchdogWorkflow : supervisorWorkflow);

  await runSupervisor({
    repository: "owner/repo", githubToken: "token", fetchImpl, nowMs: 0, readFileImpl,
  });
  assert.equal(patches.length, 1, "the first run must open/refresh #66");
  assert.match(patches[0].body, /the watchdog permissions do not exactly match the reviewed allowlist/u);

  // The second run sees #66 already open, so securityStopReasons legitimately adds one new,
  // self-referential "open security stop #66" line that could not have been present before #66 was
  // reopened — this single settling write is expected and bounded, not the bug. What matters is that
  // it is the *same* settling write regardless of which caller runs it, and that nothing churns
  // after it.
  await runWatchdog({
    repository: "owner/repo", githubToken: "token", eventName: "schedule", fetchImpl, readFileImpl,
  });
  assert.equal(patches.length, 2, "exactly one settling write for #66 legitimately becoming open, no more");
  const settled = patches.at(-1).body;

  await runSupervisor({
    repository: "owner/repo", githubToken: "token", fetchImpl, nowMs: 0, readFileImpl,
  });
  assert.equal(patches.length, 2, "the supervisor must not re-patch a body the watchdog already settled");

  await runWatchdog({
    repository: "owner/repo", githubToken: "token", eventName: "schedule", fetchImpl, readFileImpl,
  });
  assert.equal(patches.length, 2, "repeated alternation never churns further once both callers agree");
  assert.equal(issue66.body, settled);
});
