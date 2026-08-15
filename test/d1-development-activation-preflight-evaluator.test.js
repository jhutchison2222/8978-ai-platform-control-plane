import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseJsonStrict } from "../src/canonical-digest.js";
import { D1DevelopmentActivationPreflightEvaluator } from "../src/d1-development-activation-preflight-evaluator.js";

const COMMIT = "e".repeat(40);
const WRITER = Object.freeze({ principalId: "activation-writer", keyId: "activation-writer-key" });
const plan = parseJsonStrict(await readFile("deployment/development-activation-plan.json", "utf8"));

test("D1 activation preflight evaluator injects only the reviewed evidence chain", async () => {
  let queries = 0;
  const database = Object.freeze({ prepare() { queries += 1; throw new Error("query not expected"); } });
  const now = () => new Date("2026-08-15T13:00:00.000Z");
  const evaluator = new D1DevelopmentActivationPreflightEvaluator(database, {
    authorizedWriter: WRITER,
    reviewedCommit: COMMIT,
    now,
  });

  assert.equal(evaluator.evidenceVerifier.constructor.name, "AuthenticatedDevelopmentActivationEvidenceChainVerifier");
  assert.equal(evaluator.evidenceVerifier.now, now);
  assert.equal(evaluator.evidenceVerifier.evidenceVerifier.bundleProvider.database, database);
  assert.equal(evaluator.evidenceVerifier.evidenceVerifier.identityVerifier.database, database);
  assert.equal(evaluator.evidenceVerifier.evidenceVerifier.ownerVerifier.database, database);
  assert.equal(evaluator.evidenceVerifier.writeReceiptVerifier.database, database);
  assert.equal(Object.isFrozen(evaluator), true);

  const report = await evaluator.evaluate(plan);
  assert.equal(report.ready, false);
  assert.equal(report.environment, "development");
  assert.equal(report.blockers.length, 19);
  assert.equal(report.blockers.includes("independent_evidence_verifier_unavailable"), false);
  assert.equal(queries, 0);
});

test("D1 activation preflight evaluator rejects invalid construction and malformed plans", async () => {
  const database = Object.freeze({ prepare() { throw new Error("query not expected"); } });
  const options = { authorizedWriter: WRITER, reviewedCommit: COMMIT, now: () => new Date() };
  assert.throws(() => new D1DevelopmentActivationPreflightEvaluator(null, options), /D1 binding is unavailable/);
  assert.throws(() => new D1DevelopmentActivationPreflightEvaluator(database, {
    ...options, unexpected: true,
  }), /options must be exact/);
  const evaluator = new D1DevelopmentActivationPreflightEvaluator(database, options);
  await assert.rejects(() => evaluator.evaluate({ ...plan, unexpected: true }), /plan fields/);
});
