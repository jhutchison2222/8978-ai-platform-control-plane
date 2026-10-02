import { AuthenticatedDevelopmentActivationEvidenceChainVerifier } from "./development-activation-evidence-chain-verifier.js";
import { AuthenticatedDevelopmentActivationEvidenceVerifier } from "./development-activation-evidence-verifier.js";
import { D1DevelopmentActivationEvidenceBundleProvider } from "./d1-development-activation-evidence-provider.js";
import { D1DevelopmentActivationEvidenceWriteVerifier } from "./d1-development-activation-evidence-write-verifier.js";
import { D1Ed25519OwnerDecisionVerifier } from "./d1-owner-control-runtime.js";
import { D1Ed25519IdentityVerifier } from "./d1-validation-runtime.js";

const OPTION_FIELDS = Object.freeze(["authorizedWriter", "now", "reviewedCommit"]);

function exactOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(OPTION_FIELDS)) {
    throw new TypeError("Development activation evidence composition options must be exact");
  }
}

export function createD1DevelopmentActivationEvidenceChainVerifier(database, options) {
  exactOptions(options);
  const { authorizedWriter, reviewedCommit, now } = options;
  if (typeof now !== "function") {
    throw new TypeError("Development activation evidence composition clock is unavailable");
  }
  const evidenceVerifier = new AuthenticatedDevelopmentActivationEvidenceVerifier({
    bundleProvider: new D1DevelopmentActivationEvidenceBundleProvider(database),
    identityVerifier: new D1Ed25519IdentityVerifier(database),
    ownerVerifier: new D1Ed25519OwnerDecisionVerifier(database),
    now,
  });
  const writeReceiptVerifier = new D1DevelopmentActivationEvidenceWriteVerifier(database, {
    authorizedWriter,
    reviewedCommit,
  });
  return new AuthenticatedDevelopmentActivationEvidenceChainVerifier({
    evidenceVerifier,
    writeReceiptVerifier,
    now,
  });
}
