import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CloudflareQueuePublisher, CloudflareWorkflowDispatcher } from "../../src/cloudflare-orchestrator-adapters.js";
import { createDevelopmentRuntime, developmentUnavailableRuntimeDependencies } from "../../src/development-runtime.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function envelope(overrides = {}) {
  return {
    messageId: `message-${crypto.randomUUID()}`,
    actionDigest: digest("a"),
    correlationId: "correlation-1",
    idempotencyKey: "idempotency-1",
    workflowName: "8978-ai-orchestrator-dev",
    queueName: "8978-ai-orchestrator-dev",
    projectKnowledgeRef: { recordId: "pk-1", status: "FINAL", version: "1", digest: digest("b") },
    ...overrides,
  };
}

describe("Cloudflare orchestrator adapters", () => {
  it("creates one real local Workflow instance with the exact message ID", async () => {
    const dispatcher = new CloudflareWorkflowDispatcher(env.ORCHESTRATOR_WORKFLOW, { workflowName: "8978-ai-orchestrator-dev" });
    const message = envelope();
    const result = await dispatcher.dispatch(message);
    expect(result).toEqual({ accepted: true, workflowName: "8978-ai-orchestrator-dev", instanceId: message.messageId });
    const instance = await env.ORCHESTRATOR_WORKFLOW.get(message.messageId);
    expect(instance.id).toBe(message.messageId);
    let status = await instance.status();
    for (let attempt = 0; attempt < 100 && status.status !== "complete"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      status = await instance.status();
    }
    expect(status).toMatchObject({
      status: "complete",
      output: { outcome: "execution_disabled", messageId: message.messageId, actionDigest: message.actionDigest },
    });
  });

  it("publishes through the real local Queue producer binding", async () => {
    const publisher = new CloudflareQueuePublisher(env.ORCHESTRATOR_QUEUE, { queueName: "8978-ai-orchestrator-dev" });
    const message = envelope();
    await expect(publisher.publish(message)).resolves.toEqual({
      accepted: true, queueName: "8978-ai-orchestrator-dev", messageId: message.messageId,
    });
  });

  it("rejects wrong routes, non-exact envelopes, invalid knowledge, and oversized payloads before bindings", async () => {
    const workflowCalls = [];
    const queueCalls = [];
    const dispatcher = new CloudflareWorkflowDispatcher({ async create(value) { workflowCalls.push(value); return { id: value.id }; } }, { workflowName: "8978-ai-orchestrator-dev" });
    const publisher = new CloudflareQueuePublisher({ async send(...value) { queueCalls.push(value); } }, { queueName: "8978-ai-orchestrator-dev" });
    await expect(dispatcher.dispatch(envelope({ workflowName: "wrong-workflow" }))).rejects.toThrow(/name mismatch/);
    await expect(publisher.publish(envelope({ queueName: "wrong-queue" }))).rejects.toThrow(/name mismatch/);
    await expect(dispatcher.dispatch({ ...envelope(), extra: true })).rejects.toThrow(/fields/);
    await expect(publisher.publish(envelope({ projectKnowledgeRef: { recordId: "pk-1", status: "PROPOSED", version: "1", digest: digest("b") } }))).rejects.toThrow(/Project Knowledge/);
    await expect(dispatcher.dispatch(envelope({ messageId: `m${"x".repeat(100)}` }))).rejects.toThrow(/Workflow limit/);
    await expect(publisher.publish(envelope({ correlationId: "x".repeat(140_000) }))).rejects.toThrow(/correlationId|128 KiB/);
    expect(workflowCalls).toHaveLength(0);
    expect(queueCalls).toHaveLength(0);
  });

  it("fails closed for acknowledgement mismatch and binding errors", async () => {
    const message = envelope();
    const mismatched = new CloudflareWorkflowDispatcher({ async create() { return { id: "different-instance" }; } }, { workflowName: "8978-ai-orchestrator-dev" });
    await expect(mismatched.dispatch(message)).rejects.toThrow(/acknowledgement mismatch/);
    const workflowFailure = new CloudflareWorkflowDispatcher({ async create() { throw new Error("workflow unavailable"); } }, { workflowName: "8978-ai-orchestrator-dev" });
    await expect(workflowFailure.dispatch(message)).rejects.toThrow(/workflow unavailable/);
    const queueFailure = new CloudflareQueuePublisher({ async send() { throw new Error("queue unavailable"); } }, { queueName: "8978-ai-orchestrator-dev" });
    await expect(queueFailure.publish(message)).rejects.toThrow(/queue unavailable/);
  });

  it("composes both bindings only as a complete pair and leaves readiness false", async () => {
    const runtime = createDevelopmentRuntime(env);
    expect(runtime.workflowDispatcher.constructor.name).toBe("CloudflareWorkflowDispatcher");
    expect(runtime.queuePublisher.constructor.name).toBe("CloudflareQueuePublisher");
    expect(developmentUnavailableRuntimeDependencies(env)).toEqual([]);

    const withoutQueue = { ...env, ORCHESTRATOR_QUEUE: undefined };
    expect(developmentUnavailableRuntimeDependencies(withoutQueue)).toEqual(["workflowDispatcher", "queuePublisher"]);
    const unavailable = createDevelopmentRuntime(withoutQueue);
    await expect(unavailable.workflowDispatcher.dispatch(envelope())).rejects.toThrow(/dependency unavailable/);
  });
});
