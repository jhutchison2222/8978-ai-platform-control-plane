import { createD1DevelopmentActivationEvidenceChainVerifier } from "./d1-development-activation-evidence-runtime-composition.js";
import { developmentActivationPreflight } from "./development-activation-preflight.js";

export class D1DevelopmentActivationPreflightEvaluator {
  constructor(database, options) {
    this.evidenceVerifier = createD1DevelopmentActivationEvidenceChainVerifier(database, options);
    Object.freeze(this);
  }

  async evaluate(plan) {
    return developmentActivationPreflight(plan, { evidenceVerifier: this.evidenceVerifier });
  }
}
