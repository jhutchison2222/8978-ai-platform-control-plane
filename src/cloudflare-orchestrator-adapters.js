import { canonicalize } from "./canonical-digest.js";
import { assertOrchestratorEnvelope } from "./runtime-contracts.js";

const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const MAX_ENVELOPE_BYTES = 131_072;
const encoder = new TextEncoder();

function component(value, name) {
  if (typeof value !== "string" || !COMPONENT.test(value)) throw new TypeError(`Invalid orchestrator ${name}`);
  return value;
}

function prepareEnvelope(envelope) {
  assertOrchestratorEnvelope(envelope);
  const canonical = canonicalize(envelope);
  if (encoder.encode(canonical).byteLength > MAX_ENVELOPE_BYTES) throw new Error("Orchestrator envelope exceeds 128 KiB");
  return structuredClone(envelope);
}

export class CloudflareWorkflowDispatcher {
  constructor(binding, { workflowName } = {}) {
    if (!binding || typeof binding.create !== "function") throw new TypeError("Workflow binding is unavailable");
    this.binding = binding;
    this.workflowName = component(workflowName, "workflow name");
  }

  async dispatch(envelope) {
    const message = prepareEnvelope(envelope);
    if (message.workflowName !== this.workflowName) throw new Error("Workflow binding name mismatch");
    const instance = await this.binding.create({ id: message.messageId, params: message });
    if (!instance || instance.id !== message.messageId) throw new Error("Workflow instance acknowledgement mismatch");
    return Object.freeze({ accepted: true, workflowName: this.workflowName, instanceId: instance.id });
  }
}

export class CloudflareQueuePublisher {
  constructor(binding, { queueName } = {}) {
    if (!binding || typeof binding.send !== "function") throw new TypeError("Queue binding is unavailable");
    this.binding = binding;
    this.queueName = component(queueName, "queue name");
  }

  async publish(envelope) {
    const message = prepareEnvelope(envelope);
    if (message.queueName !== this.queueName) throw new Error("Queue binding name mismatch");
    await this.binding.send(message, { contentType: "json" });
    return Object.freeze({ accepted: true, queueName: this.queueName, messageId: message.messageId });
  }
}
