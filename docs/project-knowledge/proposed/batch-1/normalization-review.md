# Batch 1 Project Knowledge Normalization Review

Status: PROPOSED — NOT GOVERNING RUNTIME KNOWLEDGE

Source package: `docs/source-material/master-prompts/batch-1/`

This review preserves the source package and cannot satisfy the runtime requirement for `FINAL` or `CURRENT` Project Knowledge. Promotion requires source comparison, validation, an independent Claude review bound to the exact commit, correction of blocking findings, version/digest generation, and owner-approved promotion.

## 1. Source Inventory

| ID | Packaged extract | Original | Coverage | Disposition |
|---|---|---|---|---|
| B1-S01 | `01-database-reactivation-master.md` | Database Reactivation checklist DOCX, 2026-06-22 | Outbound variants, transfers, read-first, opt-out, Sales Edge, Top Sales Pro | Normalize reusable rules; keep agent/campaign choices as customer configuration |
| B1-S02 | `02-sarah-james-sales-demo.md` | James prompt text, 2026-07-13 | Sarah→James, roleplay, layered selling, summaries, pricing conflicts | Normalize orchestration and method; supersede old pricing/minutes |
| B1-S03 | `03-kelly-matt-smartsite-architecture.md` | Kelly/Matt conversations, 2026-06-15–2026-07-03 | Website flow, two-tier discovery, transfer/closing, field gaps | Normalize SmartSite architecture; separate visitor and owner subjects |
| B1-S04 | `04-data-dictionary-architecture.md` | Master data dictionary XLSX, 2026-07-27 | Canonical D1, mirrors, handoffs, vocabulary, entities | Normalize principles; defer exact mappings until workbook transfer |
| B1-O01 | `current-overrides.md` | Current user direction through 2026-07-31 | Runtime, identity, pricing, minutes, trial closes, tags, isolation | Highest-precedence Batch 1 authority |

The package contains curated extracts, not byte-for-byte originals. Reusable master knowledge, subscriber configuration, entity-specific sales knowledge, and contact/session discoveries remain separate information classes.

## 2. Proposed Master Prompt Component Taxonomy

| Family | Purpose | Batch 1 examples | Scope |
|---|---|---|---|
| Identity and disclosure | Separate internal, demo, and installed identity | Internal Sales Edge/Top Sales Pro; customer-selected installed identity | Reusable rule + agent instance |
| Channel and entry | Constrain phone, website, inbound, outbound, transfer | Sarah→James phone; Kelly→Matt website; reactivation outbound | Template + session |
| Context hydration | Read authoritative context and avoid re-asking | CRM-read-first; handoff continuation; live correction wins | Runtime-prepared context |
| Conversation state | Track demo, roleplay, debrief, sale, transfer, stop | Persona boundary; high-intent/frustration override | Session state |
| Discovery method | Capture layered attributable intelligence | Issues, underlying issues, emotions, future state, urgency, objections | Entity/contact insights |
| Value and trial close | Connect multiple discoveries to benefits | Layered emotional selling | Method + offer knowledge |
| Actions and stopping | Select allowed next steps and stop safely | Transfer variants, appointment, human, opt-out | Policy + capabilities |
| Handoff and summary | Continue without restarting | Sarah/Kelly notes; James/Matt summaries | Conversation/handoff |
| Offer and pricing | Present current plan facts | SmartSite $197/$297; supporting Pro value adds | Versioned offer/plan |
| Compliance | Respect suppression and channel rules | Reactivation opt-out | Compliance + customer rules |
| Data projection | Keep D1 canonical and prepare consumer variables | CRM mirrors; AutoCalls prepared variables | Dictionary + adapters |
| Runtime safety | Keep source/proposed non-governing | Only FINAL/CURRENT can govern | Control plane |

Prompt composition binds components to agent, channel, customer, offer, entity, and session context; it does not flatten them into a single global prompt.

## 3. Conflict and Supersession Register

| ID | Historical evidence | Current outcome |
|---|---|---|
| B1-C01 | SmartSite $177/$247 | Use $197 Base and $297 Pro; preserve old prices only as history |
| B1-C02 | Included/free/unlimited AI minutes | Make no such claims and do not proactively discuss minutes |
| B1-C03 | GHL Voice AI target runtime | AutoCalls is the communications runtime; GHL is optional CRM/integration |
| B1-C04 | Internal names exposed when installed | Installed agents use customer-selected names/titles |
| B1-C05 | Matt as direct inbound phone agent | Kelly engages website visitor first; Matt continues website handoff |
| B1-C06 | Trial close after isolated issue/minimum shortcut | Use layered multi-discovery emotional/value sequence |
| B1-C07 | Yes/no or “would it be worth it” closes | Use open-ended benefit-forward trial closes |
| B1-C08 | Discovery always before action | Preserve explicit buying momentum; stop probing on frustration |
| B1-C09 | Shared production D1 | Dedicated Worker and D1 per paying production customer |
| B1-C10 | Matt demonstrates without closing | Matt sells/closes; Kelly does so when no transfer occurs |
| B1-C11 | Pro bonuses become primary sale | Original niche/demo solution stays primary |
| B1-C12 | Visitor and owner discoveries mixed | Store separate subjects, provenance, and relationships |

Supersession changes effective behavior without deleting historical evidence.

## 4. Missing-Material Register

| ID | Missing material | Needed for | Blocks |
|---|---|---|---|
| B1-M01 | Original Database Reactivation DOCX | Verify exact variants/omissions and digest | Reactivation finalization |
| B1-M02 | Complete James and related Sarah prompt versions | Verify handoff/tools/actions | Sarah→James finalization |
| B1-M03 | Complete Kelly v1/v2 and Matt versions | Reconcile every correction | Kelly→Matt finalization |
| B1-M04 | Full data-dictionary XLSX rows/tabs/options | Exact field map/migration | Final schema/dictionary |
| B1-M05 | Current AutoCalls API/MCP inventory | Confirm transfer/tools/webhooks/variables | Runtime adapters |
| B1-M06 | Project Knowledge MCP interface/bindings | Store versioned governing records | Material autonomous authorization |
| B1-M07 | Authoritative Cloudflare Queue/Workflow/Worker/R2/D1/account bindings | Avoid invented identifiers | Deployment/activation |
| B1-M08 | Service-auth identities, signing/rotation/replay contract and binding names | Implement machine authentication | Cloudflare runtime |
| B1-M09 | Claude result bound to exact candidate commit | Independent checker evidence | Promotion/merge |
| B1-M10 | Remaining master prompt inventory/order | Prevent gaps and duplication | Batches 2+ |
| B1-M11 | Jurisdiction/customer compliance rules | Complete campaign safeguards | Production campaigns |
| B1-M12 | Customer onboarding/configuration schemas | Bind masters to subscriber resources | Customer activation |

Items can be non-blocking for development while still blocking promotion, deployment, or production.

## 5. Data and Field Dependency Map

| Data class | Canonical owner | Consumer | Optional mirror | Required separation |
|---|---|---|---|---|
| Reusable master components/supersessions | Project Knowledge | Control plane/prompt composer | None | Version, digest, status, sources, checker |
| Subscriber/business configuration | Dedicated customer D1 | AutoCalls and Cloudflare | CRM config fields | Customer/environment/version |
| Agent identity/title | Dedicated customer D1 agent instance | AutoCalls variables | CRM config mirror | Never expose internal template names |
| Products/services/offers/plans/promotions | Dedicated customer D1 entities | Composer/agent | Selected CRM mirrors | Entity and relationship IDs |
| Contact discoveries | Dedicated customer D1 insight records | Next agent/follow-up | Selected current CRM fields | Contact, session, agent, channel, entity, wording, normalized meaning, confidence, state |
| Simulated visitor discoveries | Dedicated customer D1 demo/session | Kelly/Matt roleplay | Demo summary | Separate simulated subject |
| Business-owner discoveries | Dedicated customer D1 contact/entity insights | Closer/follow-up | Selected CRM mirrors | Actual prospect subject |
| Handoffs | Dedicated customer D1 conversation/handoff | Receiving AutoCalls agent | Concise CRM note | From/to agents, session, reason/outcome |
| Transcripts/recording references | AutoCalls plus D1 references | Summarizer/reviewer | CRM summary/reference | Access, retention, customer isolation |
| Controlled vocabulary/options | Project Knowledge + customer D1 | Cloudflare validation; AutoCalls strings | CRM dropdowns | Canonical code/label/version |
| Audit evidence | Append-only runtime store | Gateway/checker | None | Digest chain; no credentials |
| Provider credentials | Cloudflare secrets/bindings only | Service-auth adapters | Never | Never enter prompts, Project Knowledge, evidence, or business D1 |

Cloudflare-to-service calls use service authentication through managed secrets and bindings. Interactive Cloudflare or GitHub OAuth is not a runtime dependency.

## Promotion boundary

No item in this document authorizes merge, promotion, deployment, external writes, production changes, customer-data operations, calls, messages, or campaign activation.
