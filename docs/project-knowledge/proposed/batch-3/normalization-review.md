# Batch 3 Installed SmartSite Architecture Normalization Review

Status: PROPOSED — NOT GOVERNING RUNTIME KNOWLEDGE

Source package: `docs/source-material/master-prompts/batch-3/`

## Verdict

Batch 3 is acceptable as provenance-hardened source material only. It adds four installed SmartSite profiles and one shared framework, but it does not resolve source-version authority, profile-label collisions, current AutoCalls capabilities, canonical data contracts, compliance policy, or promotion tests. No final prompt should be composed from this package.

All twelve candidate records remain `PROPOSED` and `governing: false`.

## 1. Source Inventory Delta

| ID | File | Classification | Coverage | Limitation |
|---|---|---|---|---|
| B3-S01 | `01-smartsite-optional-transfer-assistant.md` | SOURCE_MATERIAL_ONLY | Installed front-line SmartSite assistant with optional specialist transfer | Curated extract; no author/version/supersession declaration |
| B3-S02 | `02-smartsite-standalone-sales-assistant.md` | SOURCE_MATERIAL_ONLY | Installed standalone assistant carrying the full sales path | Janet2 label conflicts with shared framework |
| B3-S03 | `03-smartsite-traditional-lead-warmer.md` | SOURCE_MATERIAL_ONLY | Installed lead warmer/appointment setter with human routes | Profile-specific behavior is not a global rule |
| B3-S04 | `04-smartsite-downstream-sales-specialist.md` | SOURCE_MATERIAL_ONLY | Installed downstream closer continuing a handoff | Requires typed handoff and current action contracts |
| B3-S05 | `05-shared-sales-capable-agent-framework.md` | SOURCE_MATERIAL_ONLY | Shared component framework and per-agent matrices | Self-claims source-of-truth authority it does not possess |
| B3-S06 | `README.md` | SOURCE_METADATA | Authority, security, runtime, and processing boundaries | Not prompt authority |
| B3-S07 | `manifest.json` | SOURCE_METADATA | Exact object IDs, sizes, digests, line counts, and reconciliation | Does not establish which historical version is authoritative |

One Batch 1 database-reactivation source was independently materialized and hashed. `manifest.json` records that reconciliation without increasing the Batch 3 record count or promoting Batch 1.

## 2. Prompt Component Taxonomy Delta

Batch 3 specializes twelve areas of the Batch 1 component taxonomy:

| ID | Component | Batch 3 specialization |
|---|---|---|
| B3-T01 | `channel.entry` | Installed live website voice/chat interaction, distinct from demo and phone entry |
| B3-T02 | `flow.variant` | Optional specialist, standalone closer, traditional lead warmer, and downstream specialist profiles |
| B3-T03 | `identity.role` | Customer-configured installed names and roles; Janet/Steve remain internal labels |
| B3-T04 | `context.hydration` | Read business, contact, session, prior summary, handoff, and live correction context before asking |
| B3-T05 | `conversation.state_policy` | High intent, direct action, support, human request, frustration, refusal, weak engagement, and endpoint precedence |
| B3-T06 | `sales.discovery` | Role-dependent discovery depth with layered adequacy and no unnecessary probing |
| B3-T07 | `sales.close` | Open-ended benefit-forward close after adequate layered evidence; historical individual closes quarantined |
| B3-T08 | `actions.tools` | Candidate booking, quote, payment, workflow, notification, and transfer families require verified contracts |
| B3-T09 | `transfer.routing_fallback` | Versioned specialist/no-specialist/human fallback selection |
| B3-T10 | `handoff.contract` | Front-line-to-downstream continuation with bounded recovery when handoff context is absent |
| B3-T11 | `records.outputs` | Structured discoveries, human-readable summary, action result, routing outcome, and ownership |
| B3-T12 | `test.acceptance` | Installed-mode, profile isolation, label-conflict, state-priority, handoff, capability, and no-invention fixtures |

## 3. Conflict and Supersession Delta

| ID | Severity | Conflict | Proposed disposition |
|---|---|---|---|
| B3-C01 | HIGH | Shared framework calls itself the required source of truth | Treat as source-only; authority requires governing Project Knowledge and owner approval |
| B3-C02 | HIGH | Framework maps Janet2 to assumed specialist transfer; selected Janet2 source is standalone/no specialist | Quarantine label; select behavior only through an immutable profile ID |
| B3-C03 | HIGH | Janet/Steve ordinal names drift across historical source versions | Never use internal ordinal/name as a runtime selector or customer identity |
| B3-C04 | HIGH | Individual trial-close instructions conflict with Batch 1 layered/open-ended normalization input | Preserve as history; prohibit isolated and closed-ended prompt composition |
| B3-C05 | HIGH | Numeric 3–4 and 5–7 action targets can conflict with state priority | Keep as historical candidates; never override high intent or stop states |
| B3-C06 | HIGH | GHL-native actions and fields are presented as available while AutoCalls is the target runtime | Treat as mapping evidence only; require current AutoCalls inventory and adapters |
| B3-C07 | HIGH | Flat CRM fields imply canonical ownership versus normalized D1 architecture | D1 remains the candidate canonical model; CRM mirrors need explicit contracts |
| B3-C08 | HIGH | Booking, payment, workflow, notification, and transfer claims lack authorization/idempotency/failure contracts | Fail closed for every unresolved action family |
| B3-C09 | MEDIUM | Internal Janet/Steve labels can leak into installed customer identity | Resolve installed identity from customer and agent-instance configuration |
| B3-C10 | HIGH | No-specialist behavior can leak into combo profiles or vice versa | Enforce versioned profile isolation and negative tests |

## 4. Missing-Material Delta

| ID | Priority | Missing material | Blocks |
|---|---|---|---|
| B3-M01 | BLOCKING | Authoritative FINAL/CURRENT Project Knowledge export and supersession chain | Governing comparison |
| B3-M02 | BLOCKING | Source author, semantic version, approval, and supersession metadata for all five originals | Version authority |
| B3-M03 | BLOCKING | Complete immutable history of installed SmartSite sibling profiles | Label and profile reconciliation |
| B3-M04 | BLOCKING | Current read-only AutoCalls agents, variables, actions, transfers, webhooks, and limits inventory | Runtime mapping |
| B3-M05 | BLOCKING | Immutable installed-profile selector and composition-manifest schema | Safe prompt assembly |
| B3-M06 | BLOCKING | Authorized action schemas, destinations, idempotency, limits, failures, and fallbacks | External actions |
| B3-M07 | BLOCKING | Versioned handoff, acknowledgement, ownership, and recovery schemas | Front-line/downstream continuity |
| B3-M08 | HIGH | Canonical D1, CRM mirror, and AutoCalls prepared-variable mapping registry | Data reads and writes |
| B3-M09 | HIGH | Customer/agent goal, identity, role, routing, and after-hours configuration schema | Installed configuration |
| B3-M10 | BLOCKING | Approved business facts, offers, prices, availability, claims, and effective dates | Knowledge responses |
| B3-M11 | BLOCKING | Website voice/chat disclosure, privacy, consent, recording, retention, and jurisdiction policy | Production use |
| B3-M12 | HIGH | Acceptance corpus for profile isolation, state priority, handoff recovery, action failure, and no-invention | Promotion |
| B3-M13 | HIGH | Observed AutoCalls transcripts, action traces, and evaluator results for these installed roles | Behavioral validation |

## 5. Data, Field, and Action Dependency Delta

| ID | Producer | Required data/contract | Consumer | Fail-closed condition |
|---|---|---|---|---|
| B3-D01 | Profile registry | Immutable installed profile ID and pinned component versions | Prompt composer | Label-only, ambiguous, or missing selector |
| B3-D02 | Customer/agent config | Installed name, role, goals, channel, routes, hours, and escalation policy | Identity and routing modules | Missing or conflicting configuration |
| B3-D03 | Context hydrator | Contact match, session, prior summary, handoff, freshness, provenance, and live corrections | Conversation policy | Ambiguous identity or stale unresolved conflict |
| B3-D04 | Approved-facts registry | Products, services, offers, pricing, process, availability, claims, and dates | Knowledge response | Missing or expired authority; never invent |
| B3-D05 | Intent/state classifier | Sales, support, human, direct action, frustration, refusal, engagement, and endpoint | Discovery and action policy | Unresolved state or policy conflict |
| B3-D06 | Capability registry | Action schema, destination, authorization, idempotency, limits, result, and fallback | AutoCalls action adapter | Any contract element unresolved |
| B3-D07 | Handoff store | Source session, discoveries, objections, urgency, desired outcome, owner, acknowledgement | Downstream specialist | Missing schema, ownership, or acknowledgement |
| B3-D08 | Mapping registry | D1 canonical fields, governed CRM mirrors, and AutoCalls variables | Read/write adapters | Direction, freshness, or conflict rule unresolved |
| B3-D09 | Compliance gateway | Disclosure, consent, privacy, retention, recording, contact, and suppression rules | Runtime policy gate | Missing, expired, or jurisdictionally inapplicable evidence |
| B3-D10 | Evaluation registry | Version-pinned scenario corpus, transcripts, traces, expected outcomes, and checker result | Promotion gate | Any required test absent or failed |

## 6. PROPOSED Project Knowledge Records

The machine-readable packet contains exactly twelve records:

1. `PK-B3-PROP-001` — Batch 3 provenance-hardened source corpus registration
2. `PK-B3-PROP-002` — Installed SmartSite immutable profile selection
3. `PK-B3-PROP-003` — Optional specialist-transfer assistant profile
4. `PK-B3-PROP-004` — Standalone full-conversation assistant profile
5. `PK-B3-PROP-005` — Traditional lead-warmer profile
6. `PK-B3-PROP-006` — Downstream specialist continuity profile
7. `PK-B3-PROP-007` — Installed-versus-demo mode boundary
8. `PK-B3-PROP-008` — Internal label and source-version conflict quarantine
9. `PK-B3-PROP-009` — Layered discovery and state-priority precedence
10. `PK-B3-PROP-010` — Installed action capability gate
11. `PK-B3-PROP-011` — Installed context, handoff, and record ownership candidate
12. `PK-B3-PROP-012` — Batch 3 unresolved-material gate

## Security and runtime boundary

No credentials are required by these records. Exact-source screening found no credential pattern. GitHub contains curated extracts and digests, not raw full prompts or secrets. Cloudflare runtime service authentication remains HMAC-based with replay defense and no OAuth dependency. This package changes no runtime code or Cloudflare configuration.

## Promotion boundary

This review authorizes no final prompt rewrite, merge, Project Knowledge promotion, AutoCalls change, Cloudflare deployment, external write, customer-data operation, call, message, campaign, booking, transfer, payment, or workflow. Independent Claude review must inspect an immutable candidate commit before any merge decision.
