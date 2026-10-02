import { D1AuthoritativeResourceResolver, D1TrustedLimitProvider } from "./d1-authority-runtime.js";
import { D1Ed25519OwnerDecisionVerifier, D1StandingStateRevalidator } from "./d1-owner-control-runtime.js";
import { D1GoverningProjectKnowledgeReader } from "./d1-project-knowledge-runtime.js";
import { D1Ed25519IdentityVerifier, D1RollbackVerifier, D1TestEvidenceProvider } from "./d1-validation-runtime.js";

export const D1_AUTHORITY_RUNTIME_DEPENDENCIES = Object.freeze([
  "resourceResolver", "identityVerifier", "evidenceProvider", "rollbackVerifier",
  "limitProvider", "ownerVerifier", "revalidateStandingState", "projectKnowledge",
]);

export function createD1AuthorityRuntimeDependencies(database, { projectKnowledgeScope = "control-plane" } = {}) {
  const standingState = new D1StandingStateRevalidator(database);
  return Object.freeze({
    resourceResolver: new D1AuthoritativeResourceResolver(database),
    identityVerifier: new D1Ed25519IdentityVerifier(database),
    evidenceProvider: new D1TestEvidenceProvider(database),
    rollbackVerifier: new D1RollbackVerifier(database),
    limitProvider: new D1TrustedLimitProvider(database),
    ownerVerifier: new D1Ed25519OwnerDecisionVerifier(database),
    revalidateStandingState: standingState.revalidate.bind(standingState),
    projectKnowledge: new D1GoverningProjectKnowledgeReader(database, { scope: projectKnowledgeScope }),
  });
}
