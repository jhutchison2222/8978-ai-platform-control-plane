import { CLOUDFLARE_ADMIN_V7 } from "./cloudflare-admin-v7-contracts.js";

export class ManagedSecretCredentialCustodian {
  constructor(api, env) {
    if (!api) throw new Error("Cloudflare API adapter is unavailable");
    this.api = api;
    this.env = env;
  }

  async store(kind, credential) {
    if (kind !== "access-service-token") throw new Error("Only the bounded Access credential may be retained");
    await this.api.installConnectorAccessCredential(JSON.stringify({
      tokenId: credential.tokenId,
      target: credential.target,
      clientId: credential.clientId,
      clientSecret: credential.clientSecret,
      expiresAt: credential.expiresAt,
    }));
    return {
      receiptId: `managed-secret:${CLOUDFLARE_ADMIN_V7.accessCredentialSecretName}`,
      custodian: `${CLOUDFLARE_ADMIN_V7.connectorWorkerName}:${CLOUDFLARE_ADMIN_V7.accessCredentialSecretName}`,
    };
  }

  async readAccessCredential(receiptId) {
    if (receiptId !== `managed-secret:${CLOUDFLARE_ADMIN_V7.accessCredentialSecretName}`) throw new Error("Access credential receipt does not match the pinned managed secret");
    let parsed;
    try {
      parsed = JSON.parse(this.env?.[CLOUDFLARE_ADMIN_V7.accessCredentialSecretName]);
    } catch {
      throw new Error("Managed Access credential secret is unavailable or invalid");
    }
    if (parsed?.target !== CLOUDFLARE_ADMIN_V7.workerUrl || typeof parsed?.clientId !== "string" || typeof parsed?.clientSecret !== "string") {
      throw new Error("Managed Access credential does not match the pinned development target");
    }
    return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
  }
}
