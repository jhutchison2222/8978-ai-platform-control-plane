import { digestCanonicalValue } from "./canonical-digest.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const PURPOSES = Object.freeze(new Set([
  "maker_validation",
  "checker_validation",
  "resource_activation_authorization",
  "worker_deployment_authorization",
  "rollback_evidence",
  "backup_evidence",
]));
const EVIDENCE_FIELDS = Object.freeze([
  "backupDigest", "checkerValidationDigest", "makerValidationDigest",
  "resourceActivationAuthorizationDigest", "reviewedCommit", "rollbackEvidenceDigest",
  "workerDeploymentAuthorizationDigest",
]);
const BUNDLE_FIELDS = Object.freeze([
  "backupAttestation", "checkerValidationAttestation", "makerValidationAttestation",
  "resourceActivationDecision", "rollbackAttestation", "schemaVersion", "workerDeploymentDecision",
]);
const IDENTITY_RESULT_FIELDS = Object.freeze([
  "actionDigest", "attestationId", "evidenceDigest", "principalId", "role",
]);
const OWNER_DECISION_FIELDS = Object.freeze([
  "decidedAt", "decidedBy", "decision", "decisionId", "expiresAt", "issuerKeyId",
  "requestedActionDigest", "signature", "signatureAlgorithm",
]);

function exactFields(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new TypeError(`Development activation ${label} fields must be exact`);
  }
}

function component(value, label) {
  if (typeof value !== "string" || !COMPONENT.test(value)) {
    throw new TypeError(`Invalid development activation ${label}`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`Invalid development activation ${label}`);
  }
  return value;
}

function token(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
    throw new TypeError(`Invalid development activation ${label}`);
  }
  return value;
}

function assertEvidence(evidence) {
  exactFields(evidence, EVIDENCE_FIELDS, "evidence");
  if (typeof evidence.reviewedCommit !== "string" || !COMMIT.test(evidence.reviewedCommit)) {
    throw new TypeError("Invalid development activation reviewed commit");
  }
  const digests = EVIDENCE_FIELDS.filter((field) => field !== "reviewedCommit")
    .map((field) => digest(evidence[field], field));
  if (new Set(digests).size !== digests.length) {
    throw new Error("Development activation evidence digests must be unique");
  }
}

function assertIdentityResult(result, { role, actionDigest, evidenceDigest, label }) {
  exactFields(result, IDENTITY_RESULT_FIELDS, `${label} result`);
  if (result.role !== role || result.actionDigest !== actionDigest || result.evidenceDigest !== evidenceDigest) {
    throw new Error(`Development activation ${label} binding mismatch`);
  }
  component(result.principalId, `${label} principal ID`);
  component(result.attestationId, `${label} attestation ID`);
}

function ownerDecisionPayload(decision, { actionDigest, label }) {
  exactFields(decision, OWNER_DECISION_FIELDS, `${label} decision`);
  component(decision.decisionId, `${label} decision ID`);
  component(decision.decidedBy, `${label} owner principal ID`);
  component(decision.issuerKeyId, `${label} owner key ID`);
  token(decision.signature, `${label} owner signature`);
  if (decision.decision !== "approved" || decision.signatureAlgorithm !== "Ed25519" ||
      decision.requestedActionDigest !== actionDigest) {
    throw new Error(`Development activation ${label} owner binding mismatch`);
  }
  const { signature: _signature, ...payload } = decision;
  return payload;
}

export async function developmentActivationPurposeDigest(reviewedCommit, purpose) {
  if (typeof reviewedCommit !== "string" || !COMMIT.test(reviewedCommit) || !PURPOSES.has(purpose)) {
    throw new TypeError("Invalid development activation evidence purpose");
  }
  return digestCanonicalValue({ environment: "development", purpose, reviewedCommit, schemaVersion: "1.0.0" });
}

export async function digestDevelopmentActivationOwnerDecision(decision, { actionDigest, label = "owner" } = {}) {
  digest(actionDigest, "owner action digest");
  return digestCanonicalValue(ownerDecisionPayload(decision, { actionDigest, label }));
}

export class AuthenticatedDevelopmentActivationEvidenceVerifier {
  constructor({ bundleProvider, identityVerifier, ownerVerifier, now = () => new Date() } = {}) {
    if (!bundleProvider || typeof bundleProvider.read !== "function") {
      throw new TypeError("Development activation evidence bundle provider is unavailable");
    }
    if (!identityVerifier || typeof identityVerifier.verify !== "function") {
      throw new TypeError("Development activation identity verifier is unavailable");
    }
    if (!ownerVerifier || typeof ownerVerifier.verify !== "function") {
      throw new TypeError("Development activation owner verifier is unavailable");
    }
    if (typeof now !== "function") throw new TypeError("Development activation clock is unavailable");
    this.bundleProvider = bundleProvider;
    this.identityVerifier = identityVerifier;
    this.ownerVerifier = ownerVerifier;
    this.now = now;
    Object.freeze(this);
  }

  async verify(evidence) {
    assertEvidence(evidence);
    const requestedEvidence = Object.freeze({ ...evidence });
    const bundle = structuredClone(await this.bundleProvider.read(requestedEvidence));
    exactFields(bundle, BUNDLE_FIELDS, "evidence bundle");
    if (bundle.schemaVersion !== "1.0.0") throw new Error("Development activation evidence bundle version mismatch");
    token(bundle.makerValidationAttestation, "maker validation attestation");
    token(bundle.checkerValidationAttestation, "checker validation attestation");
    token(bundle.rollbackAttestation, "rollback attestation");
    token(bundle.backupAttestation, "backup attestation");

    const purposes = {};
    for (const purpose of PURPOSES) {
      purposes[purpose] = await developmentActivationPurposeDigest(evidence.reviewedCommit, purpose);
    }
    Object.freeze(purposes);
    const resourcePayload = ownerDecisionPayload(bundle.resourceActivationDecision, {
      actionDigest: purposes.resource_activation_authorization,
      label: "resource activation",
    });
    const workerPayload = ownerDecisionPayload(bundle.workerDeploymentDecision, {
      actionDigest: purposes.worker_deployment_authorization,
      label: "Worker deployment",
    });
    if (resourcePayload.decisionId === workerPayload.decisionId) {
      throw new Error("Development activation owner decisions must be distinct");
    }
    Object.freeze(bundle.resourceActivationDecision);
    Object.freeze(bundle.workerDeploymentDecision);
    Object.freeze(bundle);

    const now = this.now();
    const [maker, checker, rollback, backup, resourceApproved, workerApproved] = await Promise.all([
      this.identityVerifier.verify(bundle.makerValidationAttestation, {
        role: "maker", actionDigest: purposes.maker_validation, now,
      }),
      this.identityVerifier.verify(bundle.checkerValidationAttestation, {
        role: "checker", actionDigest: purposes.checker_validation, now,
      }),
      this.identityVerifier.verify(bundle.rollbackAttestation, {
        role: "checker", actionDigest: purposes.rollback_evidence, now,
      }),
      this.identityVerifier.verify(bundle.backupAttestation, {
        role: "maker", actionDigest: purposes.backup_evidence, now,
      }),
      this.ownerVerifier.verify(bundle.resourceActivationDecision, {
        actionDigest: purposes.resource_activation_authorization, now,
      }),
      this.ownerVerifier.verify(bundle.workerDeploymentDecision, {
        actionDigest: purposes.worker_deployment_authorization, now,
      }),
    ]);
    if (resourceApproved !== true || workerApproved !== true) {
      throw new Error("Development activation owner authorization signature invalid");
    }

    assertIdentityResult(maker, {
      role: "maker", actionDigest: purposes.maker_validation,
      evidenceDigest: evidence.makerValidationDigest, label: "maker validation",
    });
    assertIdentityResult(checker, {
      role: "checker", actionDigest: purposes.checker_validation,
      evidenceDigest: evidence.checkerValidationDigest, label: "checker validation",
    });
    assertIdentityResult(rollback, {
      role: "checker", actionDigest: purposes.rollback_evidence,
      evidenceDigest: evidence.rollbackEvidenceDigest, label: "rollback evidence",
    });
    assertIdentityResult(backup, {
      role: "maker", actionDigest: purposes.backup_evidence,
      evidenceDigest: evidence.backupDigest, label: "backup evidence",
    });

    const resourceDigest = await digestCanonicalValue(resourcePayload);
    const workerDigest = await digestCanonicalValue(workerPayload);
    if (resourceDigest !== evidence.resourceActivationAuthorizationDigest ||
        workerDigest !== evidence.workerDeploymentAuthorizationDigest) {
      throw new Error("Development activation owner authorization evidence mismatch");
    }
    if (maker.principalId !== backup.principalId || checker.principalId !== rollback.principalId ||
        resourcePayload.decidedBy !== workerPayload.decidedBy) {
      throw new Error("Development activation evidence role continuity mismatch");
    }
    const principals = [maker.principalId, checker.principalId, resourcePayload.decidedBy];
    if (new Set(principals).size !== principals.length) {
      throw new Error("Development activation maker, checker, and owner must be distinct principals");
    }

    const verificationDigest = await digestCanonicalValue({
      evidence: requestedEvidence,
      makerPrincipalId: maker.principalId,
      checkerPrincipalId: checker.principalId,
      ownerPrincipalId: resourcePayload.decidedBy,
      purposeActionDigests: purposes,
      schemaVersion: "1.0.0",
    });
    return Object.freeze({
      ...requestedEvidence,
      valid: true,
      makerPrincipalId: maker.principalId,
      checkerPrincipalId: checker.principalId,
      ownerPrincipalId: resourcePayload.decidedBy,
      verificationDigest,
    });
  }
}
