import assert from "node:assert/strict";
import test from "node:test";
import { createD1DevelopmentActivationEvidenceChainVerifier } from "../src/d1-development-activation-evidence-runtime-composition.js";

const COMMIT = "d".repeat(40);
const WRITER = Object.freeze({ principalId: "activation-writer", keyId: "activation-writer-key" });
const database = Object.freeze({ prepare() { throw new Error("query not expected"); } });

test("D1 activation evidence composition constructs the exact reviewed single-clock chain", () => {
  const now = () => new Date("2026-08-14T22:00:00.000Z");
  const chain = createD1DevelopmentActivationEvidenceChainVerifier(database, {
    authorizedWriter: WRITER,
    reviewedCommit: COMMIT,
    now,
  });

  assert.equal(chain.constructor.name, "AuthenticatedDevelopmentActivationEvidenceChainVerifier");
  assert.equal(chain.now, now);
  assert.equal(chain.evidenceVerifier.constructor.name, "AuthenticatedDevelopmentActivationEvidenceVerifier");
  assert.equal(chain.evidenceVerifier.now, now);
  assert.equal(chain.evidenceVerifier.bundleProvider.constructor.name, "D1DevelopmentActivationEvidenceBundleProvider");
  assert.equal(chain.evidenceVerifier.identityVerifier.constructor.name, "D1Ed25519IdentityVerifier");
  assert.equal(chain.evidenceVerifier.ownerVerifier.constructor.name, "D1Ed25519OwnerDecisionVerifier");
  assert.equal(chain.writeReceiptVerifier.constructor.name, "D1DevelopmentActivationEvidenceWriteVerifier");
  assert.equal(chain.evidenceVerifier.bundleProvider.database, database);
  assert.equal(chain.evidenceVerifier.identityVerifier.database, database);
  assert.equal(chain.evidenceVerifier.ownerVerifier.database, database);
  assert.equal(chain.writeReceiptVerifier.database, database);
  assert.deepEqual(chain.writeReceiptVerifier.authorizedWriter, WRITER);
  assert.notEqual(chain.writeReceiptVerifier.authorizedWriter, WRITER);
  assert.equal(chain.writeReceiptVerifier.reviewedCommit, COMMIT);
  assert.equal(Object.isFrozen(chain), true);
});

test("D1 activation evidence composition rejects missing, extra, or malformed authority inputs", () => {
  const options = { authorizedWriter: WRITER, reviewedCommit: COMMIT, now: () => new Date() };
  assert.throws(() => createD1DevelopmentActivationEvidenceChainVerifier(database), /options must be exact/);
  assert.throws(() => createD1DevelopmentActivationEvidenceChainVerifier(database, {
    ...options, unexpected: true,
  }), /options must be exact/);
  assert.throws(() => createD1DevelopmentActivationEvidenceChainVerifier(database, {
    ...options, now: null,
  }), /clock is unavailable/);
  assert.throws(() => createD1DevelopmentActivationEvidenceChainVerifier(null, options), /D1 binding is unavailable/);
  assert.throws(() => createD1DevelopmentActivationEvidenceChainVerifier(database, {
    ...options, reviewedCommit: "invalid",
  }), /reviewed commit/);
  assert.throws(() => createD1DevelopmentActivationEvidenceChainVerifier(database, {
    ...options, authorizedWriter: { principalId: "activation-writer" },
  }), /fields must be exact/);
});

test("D1 activation evidence composition rejects ambient default database fallback", () => {
  const options = { authorizedWriter: WRITER, reviewedCommit: COMMIT, now: () => new Date() };
  globalThis.__DEFAULT_AUTHORITY_DB__ = database;
  try {
    assert.throws(
      () => createD1DevelopmentActivationEvidenceChainVerifier(null, options),
      /D1 binding is unavailable/,
    );
  } finally {
    delete globalThis.__DEFAULT_AUTHORITY_DB__;
  }
});
