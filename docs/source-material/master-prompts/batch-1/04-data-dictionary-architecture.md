# Master Data Dictionary Architecture — Curated Source Extract

Status: SOURCE MATERIAL ONLY

Original source: `ai_employees_master_data_dictionary_v1.xlsx` (ChatGPT File Library; created 2026-07-27).

## What the workbook represents

The workbook inventories GHL contact fields and Custom Values and maps them toward canonical D1 structures, AutoCalls variables, employee packages, data scopes, authoritative systems, and dispositions.

Important architectural themes visible in the source:

- GHL contact fields can remain staff/workflow-visible mirrors for selected current contact/discovery state.
- D1 is intended to hold structured normalized intelligence, configuration, mappings, conversations, summaries, handoffs and repeatable entity records.
- AutoCalls should receive prepared role-specific variables rather than becoming the source of truth for every field.
- Customer-selected AI employee names belong to agent/subscriber configuration, not hard-coded internal persona names.
- Conversation-specific handoff data should not be stored as account-level Custom Values.

## Examples of scope normalization

The source explicitly flags items such as `janet_handoff_notes` as mis-scoped when stored as account-level Custom Values and proposes moving them to contact/conversation structures and retiring the Custom Value as the canonical location.

Contact fields such as `ai_receptionist_handoff_notes`, `ai_sales_assistant_handoff_notes`, `ai_sales_rep_handoff_notes`, transfer outcomes, call summaries and SmartSite handoff preferences are mapped toward D1 conversation/handoff records with GHL summary mirrors.

Agent names such as inbound/outbound/SmartSite sales rep names are mapped toward agent configuration/agent-instance structures and can be promoted from prospect onboarding into subscriber configuration.

## Entity/discovery separation

The workbook distinguishes contact discovery intelligence from reusable business/catalog/configuration data. It proposes structured insight sets/items for pain points, hot buttons and related discovery rather than relying only on flattened text fields.

The controlled vocabulary tab includes canonical insight/action concepts such as future emotion, objection, urgency trigger, decision driver, consequence, value connection, commitment, and action results/stopping reasons.

This supports the current architecture requirement that products, services, offers, AI employee types/instances, demo types, plans, promotions and similar entities each have their own related sales/discovery knowledge instead of sharing one mixed record.

## Important historical conflict

The workbook Executive Summary contains an older design assumption describing one primary multi-tenant D1 database with strict tenant IDs. That is now superseded for production customer isolation. Current production architecture requires a separate Worker and separate D1 database for every production customer. The workbook remains useful for field-level normalization and migration logic but not as authority for the old shared-production tenancy model.

## Source-of-truth pattern

The workbook repeatedly uses a pattern such as `D1 canonical; GHL Custom Value mirror` or `D1 structured intelligence` with target tables for configuration, organizations/locations, conversations, handoffs, products/services/plans/offers, business differentiators, insight sets/items and related structures.

This is source evidence for the intended cross-platform canonical data dictionary and transformation layer, while final table names and runtime mappings remain subject to CURRENT/FINAL Project Knowledge.
