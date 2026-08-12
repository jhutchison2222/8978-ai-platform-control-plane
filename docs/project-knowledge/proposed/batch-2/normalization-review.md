# Batch 2 Master Prompt Architecture Normalization Review

Status: PROPOSED — NOT GOVERNING RUNTIME KNOWLEDGE

Source package: `docs/source-material/master-prompts/batch-2/`

## Verdict

Batch 2 is acceptable as curated source material only. It adds two inbound-phone profiles but does not supply immutable originals, exact extraction anchors, authoritative Project Knowledge, current AutoCalls capability evidence, or deployable action and routing contracts. No final prompt should be composed from this package.

This review normalizes ten candidate records without promoting them. All records are `PROPOSED` and `governing: false`.

## 1. Source Inventory Delta

| ID | File | Classification | Coverage | Limitation |
|---|---|---|---|---|
| B2-S01 | `01-direct-inbound-phone-sales-specialist.md` | SOURCE_MATERIAL_ONLY | Direct inbound phone specialist, intent, discovery, actions, summaries, field evidence | Curated extract from a 71-page DOCX; original bytes, digest, and exact anchors absent |
| B2-S02 | `02-phone-receptionist-no-ai-sales-rep.md` | SOURCE_MATERIAL_ONLY | No-specialist-transfer receptionist, intent, traditional actions, handoffs, field evidence | Curated extract from a 61-page DOCX; original bytes, digest, and exact anchors absent |
| B2-S03 | `README.md` | SOURCE_METADATA | Processing, authority, quarantine, and promotion boundaries | Describes transfer policy; not prompt authority |
| B2-S04 | `manifest.json` | SOURCE_METADATA | Source inventory and required outputs | Does not include source object IDs, hashes, extraction method, or curator identity |

Credential-shaped historical material is described as quarantined but is not identified by immutable artifact ID or sanitized digest. It is excluded from evidence.

## 2. Prompt Component Taxonomy Delta

Batch 2 does not replace Batch 1's 24-component taxonomy. It specializes ten areas:

| Delta ID | Component | Batch 2 specialization |
|---|---|---|
| B2-T01 | `channel.entry` | Direct inbound phone versus receptionist entry |
| B2-T02 | `flow.variant` | No-specialist-transfer is a distinct profile, not a global rule |
| B2-T03 | `conversation.state_policy` | Intent classification precedes sales behavior |
| B2-T04 | `context.hydration` | Silent new/returning/known caller resolution; live correction wins |
| B2-T05 | `identity.role` | Customer-configured inbound names/titles; internal Top Sales Pro suppressed |
| B2-T06 | `sales.discovery` | Layered discovery only while engagement and state support it |
| B2-T07 | `actions.tools` | Candidate action families require verified capability and destination contracts |
| B2-T08 | `transfer.routing_fallback` | Human/support/direct-action fallbacks and variant-specific transfer prohibition |
| B2-T09 | `handoff.contract` / `records.outputs` | Separate sales and support handoffs, outcomes, and summaries |
| B2-T10 | `test.acceptance` | Entry, intent, stop-state, capability, no-transfer, identity, and no-invention fixtures |

## 3. Conflict and Supersession Delta

| ID | Severity | Conflict | Proposed disposition |
|---|---|---|---|
| B2-C01 | HIGH | Individual or isolated trial closes versus layered multi-item connection | Preserve examples as history; require the layered adequacy gate before any trial close |
| B2-C02 | HIGH | Closed-ended confirmation examples versus open-ended benefit-forward guidance | Prohibit yes/no and doubt-planting patterns in later candidate prompts |
| B2-C03 | HIGH | Five-motivator and 3–7 action-attempt targets versus high-intent and stop states | Numeric targets remain historical candidates and never override state priority |
| B2-C04 | HIGH | HighLevel-native field/action language versus unverified AutoCalls capability | Treat as mapping evidence only; require current AutoCalls contracts |
| B2-C05 | HIGH | No-specialist-transfer receptionist versus optional/assumed-transfer variants | Keep a deterministic versioned selector; never generalize one variant |
| B2-C06 | MEDIUM | Top Sales Pro/internal labels versus installed customer-facing identity | Resolve from subscriber and agent-instance configuration; suppress internal labels |
| B2-C07 | HIGH | Flattened CRM discovery fields versus normalized D1 ownership | D1 candidate model owns structured records; CRM contains governed mirrors only |
| B2-C08 | HIGH | Broad candidate action lists versus authorization and destination requirements | Fail closed unless capability, identifiers, policy, idempotency, and fallback are verified |

All dispositions remain `PROPOSED` unless already controlled by a separately identified governing baseline.

## 4. Missing-Material Delta

| ID | Priority | Missing material | Blocks |
|---|---|---|---|
| B2-M01 | BLOCKING | Immutable original DOCX objects, hashes, exact anchors, extraction method, and curator | Source fidelity and promotion |
| B2-M02 | BLOCKING | Authoritative FINAL/CURRENT Project Knowledge export and supersession chain | Governing comparison |
| B2-M03 | BLOCKING | Complete historical and deployed prompt versions for these and sibling variants | Variant reconciliation |
| B2-M04 | BLOCKING | Current read-only AutoCalls agent, variable, action, transfer, webhook, and limit inventory | Runtime mapping |
| B2-M05 | BLOCKING | Versioned inbound intent/session state machine | Prompt composition |
| B2-M06 | BLOCKING | Authorized action/tool schemas, identifiers, idempotency, failure, and fallback contracts | Action implementation |
| B2-M07 | BLOCKING | Customer-specific human/support/after-hours routing matrix | Safe routing |
| B2-M08 | HIGH | Subscriber and agent-instance identity/title configuration schema | Installed identity |
| B2-M09 | HIGH | Versioned sales/support handoff, summary, ownership, and acknowledgement schemas | Continuity |
| B2-M10 | HIGH | Complete HighLevel field IDs plus D1/CRM/AutoCalls mapping and reconciliation rules | Data adapters |
| B2-M11 | BLOCKING | Owner/legal-approved inbound recording, consent, privacy, retention, and jurisdiction policy | Production use |
| B2-M12 | HIGH | Acceptance corpus for entry profiles, intent, stop states, no-transfer, capability failures, and no-invention | Promotion |

## 5. Data, Field, and Action Dependency Delta

| ID | Producer | Required data/contract | Consumer | Fail-closed condition |
|---|---|---|---|---|
| B2-D01 | Runtime context hydrator | Contact match, freshness, prior summaries, live corrections | Both inbound profiles | Ambiguous identity or stale conflict |
| B2-D02 | Intent classifier | Sales/support/direct action/human/general/unclear code and confidence | State policy and router | Unclear intent remains unresolved |
| B2-D03 | Subscriber/agent config | Entry profile and no-transfer/optional/assumed-transfer selector | Prompt composer | Profile not deterministically resolved |
| B2-D04 | Catalog/config knowledge | Approved facts, offers, prices, availability, processes, differentiators | Agent response | Missing authority; never invent |
| B2-D05 | Discovery store | Attributable insight items, emotion, urgency, objection, state | Sales method | Stop state or inadequate layered evidence |
| B2-D06 | Capability registry | Tool schema, destination, authorization, idempotency, limits, fallback | Action adapter | Any capability or identifier unresolved |
| B2-D07 | Conversation store | Separate sales/support handoff, summary, ownership, outcome | Staff/receiving workflow | Schema, owner, or acknowledgement unresolved |
| B2-D08 | Mapping registry | D1 canonical fields, selected CRM mirrors, AutoCalls prepared variables | Integration adapters | Direction, freshness, or conflict rule unresolved |
| B2-D09 | Compliance/test gates | Consent, recording, privacy, retention, prohibited claims and scenario corpus | Policy gateway/promotion | Evidence missing, expired, or failed |

## 6. PROPOSED Project Knowledge Records

The machine-readable packet contains exactly ten records:

1. `PK-B2-PROP-001` — Batch 2 source corpus registration
2. `PK-B2-PROP-002` — Direct inbound phone specialist entry profile
3. `PK-B2-PROP-003` — No-specialist-transfer receptionist profile
4. `PK-B2-PROP-004` — Inbound intent and state-priority policy
5. `PK-B2-PROP-005` — Installed inbound identity resolution
6. `PK-B2-PROP-006` — Configured action capability gate
7. `PK-B2-PROP-007` — Inbound sales and support handoff separation
8. `PK-B2-PROP-008` — Historical numeric sales targets
9. `PK-B2-PROP-009` — Inbound field mapping normalization
10. `PK-B2-PROP-010` — Batch 2 unresolved-material gate

## Security and quarantine

No credential is required by these source records. Credential-shaped historical sources remain excluded. The repository must not store provider credentials, secret values, tokens, private keys, or unsanitized credential-bearing originals. GitHub holds versioned sanitized artifacts; Cloudflare secret bindings hold runtime secrets; D1 Project Knowledge stores structured records and evidence references, never secret material.

## Promotion boundary

This review authorizes no final prompt rewrite, merge, Project Knowledge promotion, AutoCalls change, Cloudflare deployment, external write, customer-data operation, call, message, or campaign. Independent Claude review must inspect an immutable candidate commit before any merge decision.
