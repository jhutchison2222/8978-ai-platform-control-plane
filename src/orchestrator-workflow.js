import { WorkflowEntrypoint } from "cloudflare:workers";
import { assertOrchestratorEnvelope } from "./runtime-contracts.js";

export class OrchestratorWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const envelope = structuredClone(event.payload);
    return step.do("validate-orchestrator-envelope", async () => {
      assertOrchestratorEnvelope(envelope);
      return {
        outcome: "execution_disabled",
        messageId: envelope.messageId,
        actionDigest: envelope.actionDigest,
      };
    });
  }
}
