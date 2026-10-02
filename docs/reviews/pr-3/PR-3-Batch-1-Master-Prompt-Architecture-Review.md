**INDEPENDENT ARCHITECTURE REVIEW**

PR \#3: Batch 1 Master Prompt Architecture Source Material

Source inventory, component taxonomy, conflict register, missing-material register, dependency map, and PROPOSED Project Knowledge packet

> **Publication note (2026-08-12):** This review inspected PR head `ff1312dfef800b27066f4885c0d022c09ad24652`. It was added to the PR branch after that branch advanced to parent head `175ae3a991e72a5461fb280b53ac404935ae4aa8`. Repository changes made after the reviewed head, including the explicit SOURCE/PROPOSED clarification in `current-overrides.md` and repository-side normalization artifacts, were not part of the original evidence set. The status-ambiguity finding is therefore retained as historical review evidence and noted as corrected at the publication parent; the remaining findings require reconciliation against the newer head. Every Project Knowledge record in this export remains `PROPOSED` and non-governing.

| **Field**     | **Value**                                                                                          |
|---------------|----------------------------------------------------------------------------------------------------|
| Repository    | jhutchison2222/8978-ai-platform-control-plane                                                      |
| Pull request  | \#3 — Add Batch 1 master prompt source material package                                            |
| Reviewed head | ff1312dfef800b27066f4885c0d022c09ad24652                                                           |
| Base          | main @ 03b2151969983cc941581312040861ffdeaf6bc6                                                    |
| Review date   | 2026-08-12 (user context: America/Denver)                                                          |
| Disposition   | ACCEPTABLE AS SOURCE MATERIAL ONLY; NOT READY for CURRENT/FINAL promotion or prompt implementation |

| **Boundary** No final AutoCalls prompt was rewritten. No repository file was changed. No merge, deployment, production activation, call, message, or external side effect occurred. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# Executive Verdict

| **REVIEW STATUS** Conditionally acceptable as a provenance-labeled source package. Nine blocking evidence/contract gaps prevent final prompt architecture, runtime mapping, or AutoCalls activation. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

The package correctly signals that it is curated source material, separates major information classes, preserves several known historical conflicts, and contains no evident secrets or cross-customer data. Its strongest architectural themes align with the governing baseline: modular prompts, D1-centered normalized data, customer-configured identities, read-first continuity, layered discovery, and per-production-customer isolation.

The principal defect is a status contradiction. One file self-labels its rules CURRENT and several extracts state that historical rules are already superseded by it. That cannot govern this review because the user explicitly classified every PR file as SOURCE MATERIAL, the package README requires PROPOSED normalization, and authoritative Project Knowledge is unavailable. Exact prices, minute-cost framing, plan value claims, and tag values therefore remain unverified proposals.

- High: status/governance contradiction can cause accidental promotion of unverified rules.

- High: original binaries and exact extract anchors are absent, so fidelity and omissions cannot be independently verified.

- High: commercial values and operational actions lack authoritative sources and deterministic execution contracts.

- High: outbound compliance is materially incomplete beyond tone and a basic opt-out instruction.

- Medium: the source narrows production isolation to “paying” customers, while governance applies it to every production customer.

- Medium: handoff, discovery, mirror, and legacy field mappings are descriptive rather than implementation-ready.

# Scope and Evidence

Inspected the exact seven files added by the draft PR at the reviewed head, the PR metadata and aggregate patch, the governing 8978 platform baseline, PR review/thread status, and CI evidence. The GitHub validate workflow run 31538567648 completed successfully. GitHub showed no review submissions and no inline review threads at inspection time.

**Governing status:** Project Knowledge + Collaboration MCP is not attached. No authoritative FINAL/CURRENT Project Knowledge comparison was possible. Decisions requiring that comparison are marked pending verification.

**Maker/checker:** Primary analysis was independently checked for security, conflicts, taxonomy, dependencies, and missing material. The checker agreed on SOURCE-only acceptance and the listed blockers.

# Source Inventory

| **ID** | **Package file**                        | **Origin**                                         | **Coverage**                                                                           | **Review status**                             |
|--------|-----------------------------------------|----------------------------------------------------|----------------------------------------------------------------------------------------|-----------------------------------------------|
| S-01   | 01-database-reactivation-master.md      | Curated DOCX extract; 2026-06-22                   | 4 reactivation profiles; CRM read-first; opt-out; transfers; Sales Edge                | Source only; original binary absent           |
| S-02   | 02-sarah-james-sales-demo.md            | Curated TXT extract; 2026-07-13                    | Phone demo handoff; modes; layered selling; high-intent/frustration; summary ownership | Source only; full prompt absent               |
| S-03   | 03-kelly-matt-smartsite-architecture.md | Curated conversation extracts; 2026-06-15 to 07-03 | Website-first flow; v1/v2; persona states; two-tier discovery; closing                 | Source only; multiple originals/ranges absent |
| S-04   | 04-data-dictionary-architecture.md      | Curated XLSX extract; 2026-07-27                   | D1/GHL/AutoCalls roles; handoff scope; normalized entities; tenancy conflict           | Source only; workbook/tabs/cells absent       |
| S-05   | current-overrides.md                    | Unattributed curated override list                 | Runtime, pricing, minutes, sales method, roles, tags, normalization                    | SOURCE candidate despite self-label CURRENT   |
| S-06   | README.md                               | Package instructions                               | Purpose, file descriptions, processing rules, archive limitation                       | Source package metadata                       |
| S-07   | manifest.json                           | Machine-readable manifest                          | Four named origins, policy flags, outputs, information classes                         | Missing hashes, source IDs, ranges, curator   |

Evidence: README.md:1-30; manifest.json:1-53; each extract:1-5.

## Source Provenance Assessment

- Confirmed: the package is pinned by Git commit/blob evidence and marks automatic FINAL promotion false.

- Confirmed limitation: originals are not included; the package contains curated extracts.

- Gap: no immutable original object ID/URL, SHA-256, page/sheet/cell/range anchor, extraction method/version, curator, or extraction timestamp.

- Implication: the package can support provisional architectural hypotheses, but cannot prove full-source fidelity, completeness, or authoritative conflict resolution.

# Proposed Master Prompt Component Taxonomy

Use orthogonal, atomic, versioned modules. A composition manifest must pin exact immutable component versions and explicit precedence. Prompts consume validated context and emit intents; deterministic tools and policy gateways own authorization and side effects.

| **\#** | **Component**                          | **Responsibility**                                                                                  |
|--------|----------------------------------------|-----------------------------------------------------------------------------------------------------|
| 1      | governance.composition                 | Manifest, provenance, status, precedence, supersession, effective dates, test requirements.         |
| 2      | safety.global                          | Secret/private-prompt non-disclosure, internal-label suppression, fail-closed identifiers/tools.    |
| 3      | compliance.channel                     | Consent, opt-out/suppression, wrong number, calling windows, recording, jurisdiction/channel rules. |
| 4      | runtime.platform                       | AutoCalls adapter; isolate legacy GHL-native runtime assumptions.                                   |
| 5      | channel.entry                          | Inbound phone, outbound reactivation, website visitor, direct demo, transferred/handoff entry.      |
| 6      | mode.persona                           | Explicit demo, installed, roleplay, debrief/closer states and transitions.                          |
| 7      | identity.role                          | Customer-selected name/role; internal template identity; exposure policy.                           |
| 8      | organization.customer_context          | Business, niche, offer, product/service, approved phrases, timezone, subscriber config.             |
| 9      | context.hydration                      | D1/CRM read-first, freshness, source ranking, live corrections, no-reask, null handling.            |
| 10     | flow.variant                           | Optional transfer, assumed transfer, no-AI transfer, downstream closer profiles.                    |
| 11     | conversation.state_policy              | Renewed interest, support, human request, high intent, frustration, refusal, opt-out, endpoint.     |
| 12     | sales.discovery                        | Layered, multi-item discovery stored as related insight records.                                    |
| 13     | sales.trial_close                      | Adequacy gate plus open-ended benefit-forward close; prohibited patterns.                           |
| 14     | sales.qualification_objections_urgency | Qualification/disqualification, objections, decision drivers, urgency, trust/proof.                 |
| 15     | demo.roleplay                          | Scenario setup, in-character performance, exit, debrief; phone and SmartSite profiles.              |
| 16     | discovery.scope                        | Separate simulated visitor and real prospect/business-owner observations.                           |
| 17     | catalog.entity_sales_knowledge         | Relational knowledge for products, services, employees, offers, demos, plans, niches.               |
| 18     | commercial.pricing_value               | Effective-dated price, usage, promotion, value-add, currency/market authority.                      |
| 19     | transfer.routing_fallback              | Eligibility, transfer policy, validated destinations, refusal/unavailable/human fallbacks.          |
| 20     | handoff.contract                       | Typed provenance-rich payload, ownership, acknowledgement, receiver continuity.                     |
| 21     | actions.tools                          | Transfer, scheduling, quote, callback, info, payment, workflow, status; adapter contracts.          |
| 22     | records.outputs                        | Summaries, handoffs, outcomes, stop reasons, plan choice, disposition tags and destinations.        |
| 23     | customer_plan_overrides                | Scoped overlays only after deterministic customer, plan, channel and employee resolution.           |
| 24     | test.acceptance                        | Golden scenarios, prohibited claims, mode leakage, nulls, stop states, isolation, tool failures.    |

## Proposed Precedence

Owner-approved FINAL → approved CURRENT → authorized environment/customer/plan instance override → channel/mode/flow profile → reusable method/catalog module → historical source. A file’s self-declared label is metadata, not promotion authority.

## Required Versioning Controls

- Immutable source snapshot ID, Git commit/blob, original artifact ID and content hash when acquired.

- Atomic component ID and revision; status, approver, effective_from/effective_to, scope dimensions, and rule-level supersession links.

- Composition manifest pinned to exact component versions, runtime adapter, schema version, test-suite version, results, and rollback target.

- Effective-dated commercial records; never embed mutable price or usage claims in generic sales methodology modules.

- Do not mark an entire source obsolete when only one rule conflicts; preserve granular provenance.

# Conflict / Supersession Register

| **ID** | **Sev** | **Topic**             | **Conflict**                                                               | **Proposed disposition**                                                                 | **Evidence**                                             |
|--------|---------|-----------------------|----------------------------------------------------------------------------|------------------------------------------------------------------------------------------|----------------------------------------------------------|
| CS-01  | HIGH    | Status authority      | current-overrides says CURRENT; package/user say SOURCE                    | Treat every entry PROPOSED; PK/owner verification required                               | current-overrides:1-5; README:1-7,23-24; manifest:3,6-10 |
| CS-02  | HIGH    | Platform runtime      | Historical GHL Voice AI vs AutoCalls target                                | Isolate legacy adapter; authoritative verification before status change                  | current-overrides:7; governance platform baseline        |
| CS-03  | HIGH    | SmartSite pricing     | \$177/\$247 vs \$197/\$297                                                 | Preserve both; effective-dated PROPOSED price record; verify authority                   | 02:45-47; 03:47-51; overrides:9                          |
| CS-04  | HIGH    | Minutes claims        | Unlimited/included/free vs prohibition and approx. \$0.25 reactive framing | Separate forbidden claim from cost framing; commercial verification required             | 02:45-47; overrides:10-11                                |
| CS-05  | MED     | Matt entry            | Direct-inbound framing vs Kelly-first website flow                         | PROPOSE Kelly-first SmartSite profile; retain legacy evidence                            | 03:7-15,28-32,47-51                                      |
| CS-06  | HIGH    | Trial closes          | Minimum-three/yes-no vs layered/open-ended/no single issue                 | PROPOSE layered method; acceptance tests must reject old patterns                        | 03:47-51; overrides:12-14; governance sales method       |
| CS-07  | HIGH    | Production tenancy    | Shared production D1 vs separate Worker+D1                                 | Governing baseline controls: separate per production customer; preserve workbook history | 04:35-37; governance:9-11                                |
| CS-08  | MED     | Identity              | Internal persona names vs customer-configured identities                   | Resolve by mode + agent-instance config; never hard-code                                 | 01:16,30; 02:13-16; 04:15-17                             |
| CS-09  | MED     | State priority        | Deep discovery/action cadence vs high intent/frustration/stop              | Encode state priority above normal sales sequence                                        | 01:56-64; 02:33-37                                       |
| CS-10  | INFO    | Transfer variants     | Optional, assumed, no transfer                                             | Not a contradiction; separate versioned profiles with deterministic selector             | 01:44-54; 03:16-20                                       |
| CS-11  | MED     | Closing owner         | Matt demo-only implication vs Matt closes; Kelly closes if no transfer     | Explicit mode/state and owner contract; verify source                                    | 03:59-61                                                 |
| CS-12  | HIGH    | Discovery populations | Simulated visitor vs actual owner risks flattening                         | Separate subject/session/synthetic scopes and destinations                               | 03:38-45; overrides:17                                   |
| CS-13  | HIGH    | Blank visitor fields  | Matt seeded from unpopulated visitor\_\* fields                            | Typed handoff producer/fallback/null contract; fail closed on ambiguity                  | 03:53-57                                                 |
| CS-14  | MED     | Handoff storage       | Account Custom Values vs conversation/contact records                      | PROPOSE D1 conversation record + governed GHL mirror migration                           | 04:19-25                                                 |

Register rule: all dispositions above are PROPOSED/OPEN unless the governing platform baseline already controls the issue. Required record fields include both source records, affected scope, rationale, effective date, approver, replacement IDs, tests, and rollback.

# Missing-Material Register

Items M1–M9 block final prompt architecture or activation. Remaining items are required before implementation acceptance or promotion.

| **ID** | **Priority** | **Required evidence/material**                                                                                                                   |
|--------|--------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| M1     | BLOCKING     | Authoritative FINAL/CURRENT Project Knowledge export and approved supersession chain.                                                            |
| M2     | BLOCKING     | Additional authoritative master-prompt material from the other ChatGPT project.                                                                  |
| M3     | BLOCKING     | Immutable raw DOCX/TXT/XLSX originals, hashes, object IDs, extraction method, and exact anchors.                                                 |
| M4     | BLOCKING     | Current AutoCalls guide plus read-only assistant, prompt, variable, tool, transfer and limit exports.                                            |
| M5     | BLOCKING     | Per-environment identifier/mapping registry: customer, account, location, agent, field, form, workflow, pipeline, tag, tool and destination IDs. |
| M6     | BLOCKING     | Canonical D1 schema/migrations/ERD, keys, enums, history/audit, retention and isolation model.                                                   |
| M7     | BLOCKING     | Versioned Sarah→James and Kelly→Matt producer/consumer handoff schemas with null/freshness/acknowledgement rules.                                |
| M8     | BLOCKING     | Authorized tool/action contracts for transfer, booking, quote, info, payment, workflow, status, opt-out and subscription.                        |
| M9     | BLOCKING     | Owner/legal-approved consent, DNC/suppression, calling windows, recording, wrong-party, retention and jurisdiction/channel policy.               |
| M10    | HIGH         | Full historical/current prompt inventory for every named agent/variant and deployed version.                                                     |
| M11    | HIGH         | Customer/subscriber configuration schema, override precedence, roles, hours, timezone, language and escalation contacts.                         |
| M12    | HIGH         | Entity catalog: claims, differentiators, proof, features/benefits, price authority, eligibility, promotions and availability.                    |
| M13    | HIGH         | D1↔GHL mirror/reconciliation specification: direction, freshness, conflicts, loops, deletion and backfill.                                       |
| M14    | HIGH         | Session/mode state machine with transitions, guards, timeouts and terminal states.                                                               |
| M15    | HIGH         | Discovery schema and merge rules: IDs, cardinality, confidence, confirmation, expiry, dedupe and amendment authority.                            |
| M16    | HIGH         | Summary/disposition schemas and outcome-to-tag decision table.                                                                                   |
| M17    | HIGH         | Customer-specific routing/fallback matrix, availability, after-hours, SLA and channel compatibility.                                             |
| M18    | MED          | Acceptance corpus, scoring rubric, promotion thresholds, conflict fixtures and adversarial/tool-failure scenarios.                               |
| M19    | MED          | Audit events, prompt/config version capture, monitoring, alerts, kill switch, rollback and incident runbook.                                     |
| M20    | MED          | Data classification, access roles, retention/deletion, redaction/export and cross-customer isolation tests.                                      |
| M21    | MED          | Language/channel behavior: SMS/WhatsApp/email, accessibility, voicemail, silence and transcription uncertainty.                                  |
| M22    | HIGH         | Commercial governance: currency, taxes/fees, effective date, market/customer eligibility, discounts and quote expiry.                            |

Evidence: README.md:23-30; manifest.json:12-36,52; source extracts; governing baseline prompt/security rules.

# Data / Field Dependency Map

Every dependency below is source-derived and PROPOSED. Exact identifiers, schemas, mappings, and authoritative systems remain unresolved unless the governing baseline states otherwise.

## D-01 Prompt composition

Consumers: role-specific AutoCalls prompts. Inputs: reusable knowledge, subscriber config, entity knowledge, contact/session history. Transform: validated role variables. Proposed authority: D1 canonical/config; selected GHL mirrors. Missing: exact schema and variable contract.

Evidence: manifest:46-50; 04:9-17,39-43

## D-02 Agent identity

Resolve customer/account/location, employee instance, mode and role to a customer-facing name. Legacy tokens in 01:24/28 are source identifiers only. Fail closed if ambiguous.

Evidence: 01:20-30; 04:15-17,25

## D-03 Reactivation context

Read lead source, inquiry, entity interest, prior quote/appointment, summaries, notes, objections, routing, pipeline, purchase state. Preserve source/time/confidence/relevance and corrections.

Evidence: 01:38-42; overrides:22-23

## D-04 Reactivation profile selector

Deterministically choose optional, assumed, no-AI or downstream closer from customer config; model must not select IDs.

Evidence: 01:9-18,44-60

## D-05 Reactivation handoff

Producer: reactivation 1/2. Consumer: downstream closer. Payload: old/live context, issue items, objections, urgency, desired outcome, transfer reason, source links. Store per session/conversation.

Evidence: 01:44-50; 04:17,21-23

## D-06 Reactivation terminal actions

Customer-enabled transfer, appointment, quote, consultation, callback, information, payment, workflow/task, message, status, opt-out, wrong number. Needs tool schema, permission, idempotency, result and stop reason.

Evidence: 01:52-55

## D-07 Sarah→James continuity

Sarah handoff + populated context feed James. Sarah owns handoff; James owns final summary/demo/objection/plan outputs. Missing values gathered naturally.

Evidence: 02:9-21,49-51

## D-08 James mode/state

Entry source, demo vs installed, roleplay phase, customer-facing title, high intent and frustration signals prevent persona leakage and probing conflicts.

Evidence: 02:11-16,33-43

## D-09 James discovery/commercial

Related pains, hot buttons, emotions, urgency, decision drivers and objections feed layered value/close. Prices/plans must come from governed commercial config.

Evidence: 02:23-31,45-47

## D-10 Kelly routing

Form/survey commitment selects v1 optional or v2 assumed transfer; refusal/frustration/fallback and no-transfer closing responsibility require mapped form semantics and state.

Evidence: 03:16-20,59-62

## D-11 Kelly→Matt handoff

Kelly/business/contact data must populate typed website visitor/offer/questions context. Validate every required Matt input has producer, fallback, freshness and null behavior.

Evidence: 03:22-32,53-57

## D-12 Matt roleplay/close

Consume business/offer/customer and simulated visitor context; separate roleplay from debrief/closer; emit governed plan recommendation/action intent.

Evidence: 03:24-36,59-62

## D-13 SmartSite discovery scopes

Keep simulated visitor/customer and actual owner/prospect insight sets separate with synthetic flag, subject ID, session kind, provenance, destination and promotion rule.

Evidence: 03:38-45

## D-14 Normalized insight/entity graph

Relate insight items to product, service, employee, offer, demo, plan, promotion and niche; retain original/normalized text, source, confidence, current relevance and state.

Evidence: 04:27-33; overrides:22-23

## D-15 Storage/mirrors

D1: normalized configuration, mappings, conversations, summaries, handoffs and repeatable entities. GHL: selected current mirrors. AutoCalls: prepared variables. Missing: reconciliation contract.

Evidence: 04:9-25,39-43

## D-16 Post-demo disposition

Map outcome deterministically to exact candidate tag, with destination, idempotent write, before/after audit and stop reason. Candidate strings are not yet authoritative.

Evidence: overrides:21

## Minimum Field Contract

| **Dimension**       | **Required properties**                                                                                    |
|---------------------|------------------------------------------------------------------------------------------------------------|
| Identity            | canonical key; external IDs by system/environment; tenant/customer; entity type; version                   |
| Value               | type/enum; nullability; cardinality; validation; normalized value; original wording                        |
| Provenance          | source system; source agent/channel/session/demo/entity; observed/updated time; extractor/source artifact  |
| State               | confidence/confirmation; priority/current relevance; resolved/contradicted/superseded; effective dates     |
| Data movement       | authoritative system; producer/consumer; transform; mirror direction; freshness; conflict policy; fallback |
| Security/operations | classification; access; retention; idempotency; audit; rollback; kill switch; test version                 |

# PROPOSED Project Knowledge Records

The following are a review packet only. They were not written to authoritative Project Knowledge because its MCP is unavailable. Every candidate remains PROPOSED; a source file cannot promote itself by label.

## PK-PROP-001 Batch 1 source corpus registration

**Type / status:** artifact_set / PROPOSED

**Candidate assertion:** Register the seven files at reviewed head as SOURCE_MATERIAL_ONLY with no automatic promotion.

**Evidence:** README:1-7,28-30; manifest:1-10,52

**Promotion dependencies:** Acquire/archive originals and hashes.

## PK-PROP-002 Master prompt modular composition model

**Type / status:** architecture_decision / PROPOSED

**Candidate assertion:** Adopt atomic versioned components and pinned composition manifests.

**Evidence:** governance prompt architecture; README:18-27

**Promotion dependencies:** Additional authoritative corpus; owner/PK review.

## PK-PROP-003 Prompt rule precedence model

**Type / status:** governance_decision / PROPOSED

**Candidate assertion:** Use explicit precedence and rule-level supersession; self-labels have no promotion authority.

**Evidence:** README:23-24; manifest:6-10

**Promotion dependencies:** Validate against FINAL/CURRENT PK.

## PK-PROP-004 Customer-facing identity and mode separation

**Type / status:** prompt_requirement / PROPOSED

**Candidate assertion:** Resolve customer-selected identity; hide internal labels; make demo/install/roleplay modes explicit.

**Evidence:** 01:16,20-30; 02:13-16; 03:34-36; 04:15-17

**Promotion dependencies:** Agent-instance config and state schema.

## PK-PROP-005 Context read-first and live correction policy

**Type / status:** prompt_requirement / PROPOSED

**Candidate assertion:** Hydrate before asking; reuse populated values; handle live corrections with provenance and controlled persistence.

**Evidence:** 01:38-42; 02:17-21

**Promotion dependencies:** Authority/freshness/mirror contract.

## PK-PROP-006 Layered discovery and trial-close method

**Type / status:** sales_method / PROPOSED

**Candidate assertion:** Use multi-item layered discovery and open benefit-forward close; state overrides stop unnecessary probing.

**Evidence:** 01:62-64; 02:23-37; overrides:12-16

**Promotion dependencies:** PK verification and test fixtures.

## PK-PROP-007 Database reactivation flow profiles

**Type / status:** agent_flow_family / PROPOSED

**Candidate assertion:** Model optional, assumed, no-AI and downstream closer as distinct profiles.

**Evidence:** 01:7-18,44-60

**Promotion dependencies:** Deterministic selector/fallback config.

## PK-PROP-008 Sarah-to-James phone demo continuity

**Type / status:** handoff_flow / PROPOSED

**Candidate assertion:** James resumes Sarah context and owns final summary.

**Evidence:** 02:7-21,49-51

**Promotion dependencies:** Typed schema and current platform mapping.

## PK-PROP-009 Kelly-to-Matt SmartSite flow

**Type / status:** handoff_flow / PROPOSED

**Candidate assertion:** Kelly engages website visitor first; Matt performs deeper roleplay/close; Kelly closes if no transfer.

**Evidence:** 03:7-36,59-61

**Promotion dependencies:** Authoritative prompt/runtime verification.

## PK-PROP-010 Two-tier SmartSite discovery isolation

**Type / status:** data_requirement / PROPOSED

**Candidate assertion:** Store simulated visitor and actual owner/prospect insight sets separately but relationally.

**Evidence:** 03:38-45; overrides:17,22-23

**Promotion dependencies:** Canonical subject/session/synthetic types.

## PK-PROP-011 Conversation handoff scope

**Type / status:** data_architecture / PROPOSED

**Candidate assertion:** Keep handoffs/summaries canonical in D1 conversation records with governed optional GHL mirrors, not account Custom Values.

**Evidence:** 04:19-25,39-43

**Promotion dependencies:** Final schema/mappings/migration.

## PK-PROP-012 Canonical data ownership pattern

**Type / status:** data_architecture / PROPOSED

**Candidate assertion:** D1 owns normalized intelligence/config/mappings; AutoCalls receives role variables; GHL holds selected mirrors.

**Evidence:** 04:7-17,39-43

**Promotion dependencies:** Compare existing schema and current configs.

## PK-PROP-013 Production customer isolation correction

**Type / status:** conflict_record / PROPOSED

**Candidate assertion:** Record workbook shared-D1 assumption as historical; governing baseline requires separate Worker and D1 for every production customer.

**Evidence:** 04:35-37; governance:9-11

**Promotion dependencies:** Write conflict record to PK; do not use “paying” qualifier.

## PK-PROP-014 SmartSite commercial terms candidate

**Type / status:** commercial_rule / PROPOSED

**Candidate assertion:** Candidate \$197 Base/\$297 Pro; prohibit unlimited/included claims; reactive approximate usage framing only.

**Evidence:** overrides:9-11

**Promotion dependencies:** Commercial owner, market/currency/tax/effective date verification.

## PK-PROP-015 Post-demo disposition vocabulary candidate

**Type / status:** controlled_vocabulary / PROPOSED

**Candidate assertion:** Candidate five exact lowercase tags.

**Evidence:** overrides:21

**Promotion dependencies:** CRM IDs, destination/workflow semantics and approval.

## PK-PROP-016 Handoff payload contract candidate

**Type / status:** schema_requirement / PROPOSED

**Candidate assertion:** Typed payload with source session/agent/channel/entity, context, insight items, objections, urgency, desired outcome, transfer reason and ownership.

**Evidence:** 01:44-46; 02:49-51; 04:21-23

**Promotion dependencies:** Required/optional fields, privacy, retention, acknowledgement.

## PK-PROP-017 State-priority and stop-condition policy

**Type / status:** prompt_requirement / PROPOSED

**Candidate assertion:** Opt-out, human/support, frustration/refusal, high intent and direct action override normal probing/action cadence.

**Evidence:** 01:32-36,48-60; 02:33-37

**Promotion dependencies:** Compliance and action mapping validation.

## PK-PROP-018 Entity-specific sales knowledge normalization

**Type / status:** data_requirement / PROPOSED

**Candidate assertion:** Store insight items separately and relate to product/service/employee/offer/demo/plan/promotion/niche.

**Evidence:** 04:27-33; governance discovery model

**Promotion dependencies:** Final entity schema and controlled vocabulary.

## PK-PROP-019 Batch 1 unresolved-material gate

**Type / status:** open_issue / PROPOSED

**Candidate assertion:** Do not finalize architecture until authoritative PK and additional master-prompt corpus are incorporated.

**Evidence:** governance prompt gate; README:23-24

**Promotion dependencies:** Attach Project Knowledge MCP and ingest remaining corpus.

# Security, Isolation, and Operational Review

**Secrets:** No evident API key, OAuth token, PIT, credential, or customer secret was found in the seven files.

**Customer isolation:** The field-normalization concepts are reusable, but the workbook extract’s “paying production customer” wording is narrower than governance. The correct controlling rule is a separate Worker and D1, customer-specific bindings/secrets/mappings, and internal/demo separation for every production customer.

**External actions:** Transfers, scheduling, quotes, links, payment, workflows, status changes, opt-outs and subscription movement must be model intents only. A deterministic policy/execution gateway must validate IDs, scope, authorization, idempotency, audit, retry, rollback and kill switch immediately before each side effect.

**Synthetic roleplay:** SmartSite roleplay requires a synthetic/simulated marker, distinct subject identity and write destination. Simulated visitor discoveries must never contaminate the real prospect record without a governed transformation.

**Compliance:** A low-pressure tone and clear opt-out stop rule are not a complete outbound compliance module. Consent, DNC/suppression, calling windows, recording, jurisdiction, wrong-party and audit rules remain owner/legal gates.

# Tests Performed and Results

| **Check**                      | **Result**              | **Evidence / implication**                                                             |
|--------------------------------|-------------------------|----------------------------------------------------------------------------------------|
| Exact-head file enumeration    | PASS                    | 7/7 files retrieved at ff1312df…; 325 additions; no deletions.                         |
| Manifest and JSON parse        | PASS                    | manifest.json structurally valid and consistent with four named origins.               |
| Status-semantics review        | FAIL / BLOCKER          | current-overrides self-label conflicts with user/package SOURCE-only status.           |
| Provenance completeness        | FAIL / BLOCKER          | Originals, hashes, exact anchors, curator/extraction metadata absent.                  |
| Secret/content inspection      | PASS with residual risk | No evident secrets in curated extracts; originals were unavailable.                    |
| Customer-isolation review      | FAIL / CORRECTION       | “paying” qualifier is too narrow; governing per-production-customer isolation applies. |
| Field producer/consumer review | FAIL / BLOCKER          | visitor\_\* defect acknowledged; typed handoff contracts absent.                       |
| Deterministic execution review | FAIL / BLOCKER          | Tool IDs, policy, idempotency, audit, rollback and kill-switch contracts absent.       |
| Outbound compliance review     | FAIL / BLOCKER          | Only partial tone/opt-out coverage.                                                    |
| GitHub validation workflow     | PASS                    | validate run 31538567648 completed successfully.                                       |
| Independent checker review     | PASS                    | Checker concurred: SOURCE-only acceptance; not ready for promotion/implementation.     |

# Containment and Rollback

- Keep PR \#3 draft and treat the path as non-runtime source storage only.

- Do not ingest \`current-overrides.md\` into a CURRENT/FINAL namespace; use SOURCE/PROPOSED status and rule-level candidate supersession links.

- Do not bind these files to AutoCalls assistants, tool variables, workflows, commercial catalogs or production prompt assemblies.

- If any downstream draft already consumed these values, roll back to the last owner-approved prompt/config version, disable related composition, and audit calls/messages/actions for unverified pricing, claims, tags, or destinations.

- Preserve the reviewed commit and original historical evidence; corrections should add explicit provenance/status rather than erase conflicts.

# Acceptance Criteria and Current Status

| **Acceptance criterion**                                                    | **Status** | **Note**                                                   |
|-----------------------------------------------------------------------------|------------|------------------------------------------------------------|
| Source-only boundary explicit across every file and machine-readable record | PARTIAL    | Package/manifest pass; current-overrides self-label fails. |
| Original artifacts archived with hashes and exact extraction anchors        | NOT MET    | Blocking provenance gap.                                   |
| Authoritative FINAL/CURRENT PK comparison and supersession review complete  | NOT MET    | MCP unavailable.                                           |
| Additional authoritative master-prompt corpus incorporated                  | NOT MET    | Explicit governance gate.                                  |
| Current AutoCalls guide/config inspected                                    | NOT MET    | Required before platform-dependent design.                 |
| Typed field/handoff/action contracts and deterministic mappings complete    | NOT MET    | Implementation blocker.                                    |
| Outbound compliance module owner/legal-approved                             | NOT MET    | Activation blocker.                                        |
| Prompt composition/versioning/test specification accepted                   | NOT MET    | Architecture remains PROPOSED.                             |
| No secrets/cross-customer data in reviewed extracts                         | MET        | Residual limitation: originals not inspected.              |
| No merge/deploy/prompt rewrite                                              | MET        | Review remained read-only.                                 |

# Required Corrections

- Change the override file’s package-level status to SOURCE MATERIAL / PROPOSED CANDIDATES, or add unambiguous front matter preventing CURRENT ingestion. Replace “supersede” assertions with proposed conflict edges pending verification.

- Add manifest entries and provenance for \`current-overrides.md\`, including who directed each rule, when, the source conversation/artifact, and effective/commercial authority if any.

- Correct the production isolation candidate to “each production customer,” and include separate runtime, Worker, D1, bindings, secrets, mappings, and internal/demo separation.

- Mark GHL Custom Value tokens as LEGACY_SOURCE_IDENTIFIER and require validated agent-instance mappings.

- Add a structured source-extract manifest: original object ID, hash, source date, page/sheet/range, extraction timestamp/method/version, curator, and claim IDs.

- Define typed state, handoff, insight, mirror and action contracts before any prompt composition. Add synthetic-roleplay isolation and live-correction audit semantics.

- Create the legal/compliance and deterministic execution gates before outbound or external-action behavior can advance.

# Project Knowledge and Claude Status

**Project Knowledge updates:** Pending. The intended MCP is not attached, so the 19 records above were prepared but not written.

**Claude collaboration:** Pending external collaboration through the intended MCP. An internal independent checker pass was completed; it is not represented as Claude or owner approval.

**Owner approval required:** Required before commercial terms become CURRENT, before legal/compliance policy is approved, before production prompt/agent activation, and before any production deployment or external-write integration.

# Next Action

| **NEXT** Keep PR \#3 draft. First correct the status/provenance ambiguity and archive the originals. Then attach/read authoritative Project Knowledge and the remaining master-prompt corpus, inspect current AutoCalls guides/configuration, and resolve M1–M9. Only after those gates should a versioned prompt-composition specification and acceptance suite be drafted. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# Evidence Index

- PR \#3: https://github.com/jhutchison2222/8978-ai-platform-control-plane/pull/3

- Reviewed head: ff1312dfef800b27066f4885c0d022c09ad24652

- Package path: docs/source-material/master-prompts/batch-1/

- Governing local reference: agent_files/references/8978-platform-governance.md

- GitHub validate workflow: run 31538567648, conclusion success.

- Retrieval date: 2026-08-12.
