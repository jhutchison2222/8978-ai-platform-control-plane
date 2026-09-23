import { CLOUDFLARE_ADMIN_V7, requireImmutableWorkerId } from "./cloudflare-admin-v7-contracts.js";

// Exactly two permitted credential kinds, each bound to its own managed-secret slot.
// The slots are distinct constants and are never aliased, shared, or derived from caller input,
// so storing or retrieving one kind can neither overwrite nor return the other.
const CREDENTIAL_SLOTS = Object.freeze({
  "access-service-token": CLOUDFLARE_ADMIN_V7.accessCredentialSecretName,
  "service-auth-principal": CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalSecretName,
});

function slotFor(kind) {
  const slot = Object.prototype.hasOwnProperty.call(CREDENTIAL_SLOTS, kind) ? CREDENTIAL_SLOTS[kind] : undefined;
  if (typeof slot !== "string") throw new Error(`Unrecognized credential kind is refused: ${String(kind)}`);
  return slot;
}

function receiptFor(slot) {
  return {
    receiptId: `managed-secret:${slot}`,
    custodian: `${CLOUDFLARE_ADMIN_V7.connectorWorkerName}:${slot}`,
  };
}

function assertPrincipalBinding(binding, { workerId, keyId } = {}) {
  if (!binding || typeof binding !== "object") throw new Error("Service-auth principal binding metadata is missing or malformed");
  if (binding.accountId !== CLOUDFLARE_ADMIN_V7.accountId) throw new Error("Service-auth principal is not bound to the authorized development account");
  if (binding.workerName !== CLOUDFLARE_ADMIN_V7.workerName) throw new Error("Service-auth principal is not bound to the pinned development Worker");
  if (binding.purpose !== "development-activation-canary") throw new Error("Service-auth principal is not bound to the approved development activation canary purpose");
  requireImmutableWorkerId(binding.workerId, "service-auth principal workerId");
  if (typeof binding.principalId !== "string" || binding.principalId !== CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId) {
    throw new Error("Service-auth principal identifier does not match the pinned development principal");
  }
  if (typeof binding.keyId !== "string" || binding.keyId.length === 0) throw new Error("Service-auth principal key ID is missing or malformed");
  if (workerId !== undefined && binding.workerId !== workerId) throw new Error("Service-auth principal is bound to a different immutable Worker ID");
  if (keyId !== undefined && binding.keyId !== keyId) throw new Error("Service-auth principal is bound to a different service-auth key ID");
  return binding;
}

export class ManagedSecretCredentialCustodian {
  constructor(api, env) {
    if (!api) throw new Error("Cloudflare API adapter is unavailable");
    this.api = api;
    this.env = env;
  }

  async store(kind, credential) {
    const slot = slotFor(kind);
    if (kind === "access-service-token") {
      await this.api.installConnectorAccessCredential(JSON.stringify({
        tokenId: credential.tokenId,
        target: credential.target,
        clientId: credential.clientId,
        clientSecret: credential.clientSecret,
        expiresAt: credential.expiresAt,
      }));
      return { ...receiptFor(slot), kind };
    }
    requireImmutableWorkerId(credential?.workerId, "service-auth principal workerId");
    if (typeof credential?.keyId !== "string" || credential.keyId.length === 0) throw new Error("Service-auth principal key ID is missing or malformed");
    if (typeof credential?.secret !== "string" || credential.secret.length < 32) throw new Error("Service-auth principal secret material is unavailable");
    if (credential?.principalId !== CLOUDFLARE_ADMIN_V7.serviceAuthPrincipalId) throw new Error("Service-auth principal identifier does not match the pinned development principal");
    await this.api.installConnectorServiceAuthPrincipal(JSON.stringify({
      accountId: CLOUDFLARE_ADMIN_V7.accountId,
      workerName: CLOUDFLARE_ADMIN_V7.workerName,
      workerId: credential.workerId,
      principalId: credential.principalId,
      keyId: credential.keyId,
      secret: credential.secret,
      purpose: "development-activation-canary",
    }));
    return { ...receiptFor(slot), kind };
  }

  // Confirms the managed secret exists by name only. No secret value is read, returned, or logged.
  async confirmCustody(kind) {
    const slot = slotFor(kind);
    const listed = await this.api.listConnectorSecrets();
    const names = (Array.isArray(listed) ? listed : Array.isArray(listed?.result) ? listed.result : [])
      .map((item) => (typeof item === "string" ? item : item?.name))
      .filter((name) => typeof name === "string");
    if (!names.includes(slot)) throw new Error(`Managed custody of ${kind} was not confirmed; stop before installing or deploying`);
    return { ...receiptFor(slot), kind, confirmed: true };
  }

  async readAccessCredential(receiptId) {
    const slot = CREDENTIAL_SLOTS["access-service-token"];
    if (receiptId !== `managed-secret:${slot}`) throw new Error("Access credential receipt does not match the pinned managed secret");
    let parsed;
    try {
      parsed = JSON.parse(this.env?.[slot]);
    } catch {
      throw new Error("Managed Access credential secret is unavailable or invalid");
    }
    if (parsed?.target !== CLOUDFLARE_ADMIN_V7.workerUrl || typeof parsed?.clientId !== "string" || typeof parsed?.clientSecret !== "string") {
      throw new Error("Managed Access credential does not match the pinned development target");
    }
    return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
  }

  async readServiceAuthPrincipal(receiptId, { workerId, keyId } = {}) {
    const slot = CREDENTIAL_SLOTS["service-auth-principal"];
    if (receiptId !== `managed-secret:${slot}`) throw new Error("Service-auth principal receipt does not match the pinned managed secret");
    let parsed;
    try {
      parsed = JSON.parse(this.env?.[slot]);
    } catch {
      throw new Error("Managed service-auth principal secret is unavailable or invalid");
    }
    assertPrincipalBinding(parsed, { workerId, keyId });
    if (typeof parsed.secret !== "string" || parsed.secret.length < 32) throw new Error("Managed service-auth principal secret material is unavailable");
    return { principalId: parsed.principalId, keyId: parsed.keyId, secret: parsed.secret };
  }
}
