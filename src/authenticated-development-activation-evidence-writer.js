import { canonicalize, digestCanonicalValue, parseJsonStrict } from "./canonical-digest.js";
import { AuthenticatedDevelopmentActivationEvidenceVerifier } from "./development-activation-evidence-verifier.js";
import { authenticateServiceRequest } from "./service-auth-adapter.js";

const COMMIT = /^[a-f0-9]{40}$/u;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u;
const MAX_BODY_BYTES = 65_536;
const MAX_VALIDITY_MS = 86_400_000;
const REQUEST_FIELDS = Object.freeze([
  "bundle", "evidence", "expiresAt", "issuedAt", "recordId", "schemaVersion", "status", "version",
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

function exactIso(value, label) {
  if (typeof value !== "string") throw new TypeError(`Invalid development activation ${label}`);
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new TypeError(`Invalid development activation ${label}`);
  }
  return timestamp;
}

function assertDatabase(database) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw new TypeError("Development activation evidence writer D1 binding is unavailable");
  }
}

function assertAuthorizedWriter(value) {
  exactFields(value, ["keyId", "principalId"], "authorized writer");
  component(value.principalId, "writer principal ID");
  component(value.keyId, "writer key ID");
  return Object.freeze({ ...value });
}

function assertRequest(request, expectedCommit, nowMs) {
  exactFields(request, REQUEST_FIELDS, "evidence write request");
  component(request.recordId, "evidence record ID");
  if (request.schemaVersion !== "1.0.0" || request.status !== "CURRENT" || request.version !== 1) {
    throw new Error("Development activation evidence write boundary changed");
  }
  if (request.evidence?.reviewedCommit !== expectedCommit) {
    throw new Error("Development activation reviewed commit is not authorized for this writer");
  }
  const issuedAtMs = exactIso(request.issuedAt, "evidence issuedAt");
  const expiresAtMs = exactIso(request.expiresAt, "evidence expiresAt");
  if (issuedAtMs > nowMs || expiresAtMs <= nowMs || expiresAtMs <= issuedAtMs ||
      expiresAtMs - issuedAtMs > MAX_VALIDITY_MS) {
    throw new Error("Development activation evidence validity window is invalid");
  }
  return { issuedAtMs, expiresAtMs };
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export class AuthenticatedDevelopmentActivationEvidenceWriter {
  constructor({
    database, secretResolver, replayStore, authorizedWriter, reviewedCommit,
    identityVerifier, ownerVerifier, allowedClockSkewMs = 300_000,
  } = {}) {
    assertDatabase(database);
    if (!secretResolver || typeof secretResolver.resolve !== "function") {
      throw new TypeError("Development activation service secret resolver is unavailable");
    }
    if (!replayStore || replayStore.atomic !== true || replayStore.durability !== "durable" ||
        typeof replayStore.consume !== "function") {
      throw new TypeError("Development activation durable replay store is unavailable");
    }
    if (!identityVerifier || typeof identityVerifier.verify !== "function") {
      throw new TypeError("Development activation identity verifier is unavailable");
    }
    if (!ownerVerifier || typeof ownerVerifier.verify !== "function") {
      throw new TypeError("Development activation owner verifier is unavailable");
    }
    if (typeof reviewedCommit !== "string" || !COMMIT.test(reviewedCommit)) {
      throw new TypeError("Invalid development activation writer reviewed commit");
    }
    if (!Number.isInteger(allowedClockSkewMs) || allowedClockSkewMs < 1 || allowedClockSkewMs > 300_000) {
      throw new TypeError("Invalid development activation service-auth replay window");
    }
    this.database = database;
    this.secretResolver = secretResolver;
    this.replayStore = replayStore;
    this.authorizedWriter = assertAuthorizedWriter(authorizedWriter);
    this.reviewedCommit = reviewedCommit;
    this.identityVerifier = identityVerifier;
    this.ownerVerifier = ownerVerifier;
    this.allowedClockSkewMs = allowedClockSkewMs;
    Object.freeze(this);
  }

  async write(request, { now = new Date() } = {}) {
    const target = request instanceof Request ? new URL(request.url) : null;
    if (!target || request.method !== "POST" ||
        target.pathname !== "/v1/development-activation/evidence" || target.search !== "") {
      throw new Error("Development activation evidence write route is unavailable");
    }
    if (request.headers.has("authorization") || request.headers.has("proxy-authorization")) {
      throw new Error("OAuth and bearer authorization headers are not accepted");
    }
    if (request.headers.get("content-type") !== "application/json") {
      throw new Error("Development activation evidence write requires application/json");
    }
    if (!(now instanceof Date) || !Number.isSafeInteger(now.valueOf())) {
      throw new TypeError("Invalid development activation evidence write time");
    }

    const authenticated = await authenticateServiceRequest({
      request,
      secretResolver: this.secretResolver,
      replayStore: this.replayStore,
      now,
      allowedClockSkewMs: this.allowedClockSkewMs,
      maxBodyBytes: MAX_BODY_BYTES,
    });
    const identity = authenticated.identity;
    if (identity.principalId !== this.authorizedWriter.principalId || identity.keyId !== this.authorizedWriter.keyId) {
      throw new Error("Development activation evidence writer is not authorized");
    }

    const text = new TextDecoder("utf-8", { fatal: true }).decode(authenticated.bodyBytes);
    const value = parseJsonStrict(text);
    if (canonicalize(value) !== text) {
      throw new Error("Development activation evidence write request must be canonical JSON");
    }
    const { issuedAtMs, expiresAtMs } = assertRequest(value, this.reviewedCommit, now.valueOf());

    const verifier = new AuthenticatedDevelopmentActivationEvidenceVerifier({
      bundleProvider: { async read(evidence) {
        if (canonicalize(evidence) !== canonicalize(value.evidence)) {
          throw new Error("Development activation evidence request binding mismatch");
        }
        return structuredClone(value.bundle);
      } },
      identityVerifier: this.identityVerifier,
      ownerVerifier: this.ownerVerifier,
      now: () => now,
    });
    const verified = await verifier.verify(value.evidence);
    if ([verified.makerPrincipalId, verified.checkerPrincipalId, verified.ownerPrincipalId]
      .includes(identity.principalId)) {
      throw new Error("Development activation writer must be independent of maker, checker, and owner");
    }

    const bundleJson = canonicalize(value.bundle);
    const bundleDigest = await digestCanonicalValue(value.bundle);
    const record = {
      recordId: value.recordId,
      status: value.status,
      reviewedCommit: value.evidence.reviewedCommit,
      evidence: value.evidence,
      bundleDigest,
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
      version: value.version,
    };
    const recordDigest = await digestCanonicalValue(record);
    const insertedAt = now.toISOString();
    const writeRecord = {
      writeId: value.recordId,
      recordId: value.recordId,
      recordDigest,
      requestBodyDigest: identity.bodyDigest,
      serviceIdentity: {
        principalId: identity.principalId,
        keyId: identity.keyId,
        nonce: identity.nonce,
      },
      authenticatedAt: identity.issuedAt,
      insertedAt,
      version: 1,
    };
    const writeDigest = await digestCanonicalValue(writeRecord);

    await this.database.batch([
      this.database.prepare(`
        INSERT INTO authority_development_activation_evidence_bundles
          (record_id, reviewed_commit, maker_validation_digest, checker_validation_digest,
           resource_activation_authorization_digest, worker_deployment_authorization_digest,
           rollback_evidence_digest, backup_digest, bundle_json, bundle_digest, record_digest,
           status, enabled, issued_at_ms, expires_at_ms, version)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'CURRENT', 1, ?12, ?13, 1
        WHERE NOT EXISTS (
          SELECT 1 FROM authority_development_activation_evidence_bundles
          WHERE reviewed_commit = ?2 AND enabled = 1 AND status IN ('CURRENT', 'FINAL')
        )
      `).bind(
        value.recordId, value.evidence.reviewedCommit, value.evidence.makerValidationDigest,
        value.evidence.checkerValidationDigest, value.evidence.resourceActivationAuthorizationDigest,
        value.evidence.workerDeploymentAuthorizationDigest, value.evidence.rollbackEvidenceDigest,
        value.evidence.backupDigest, bundleJson, bundleDigest, recordDigest, issuedAtMs, expiresAtMs,
      ),
      this.database.prepare(`
        INSERT INTO authority_development_activation_evidence_writes
          (write_id, record_id, record_digest, request_body_digest, service_principal_id,
           service_key_id, service_nonce, authenticated_at_ms, inserted_at_ms, write_digest, version)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1)
      `).bind(
        value.recordId, value.recordId, recordDigest, identity.bodyDigest, identity.principalId,
        identity.keyId, identity.nonce, Date.parse(identity.issuedAt), now.valueOf(), writeDigest,
      ),
    ]);

    return freeze({
      inserted: true,
      recordId: value.recordId,
      recordDigest,
      requestBodyDigest: identity.bodyDigest,
      writeDigest,
      servicePrincipalId: identity.principalId,
      reviewedCommit: value.evidence.reviewedCommit,
      status: "CURRENT",
      insertedAt,
    });
  }
}

export const DEVELOPMENT_ACTIVATION_EVIDENCE_WRITE_MAX_BODY_BYTES = MAX_BODY_BYTES;
