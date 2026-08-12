# Phone Receptionist — No AI Sales Rep Transfer — Curated Source Extract

Status: SOURCE MATERIAL ONLY

Original source: `PHONE RECEPTIONIST - NO ai sales rep.docx` (Library; created 2026-07-19; 61 pages).

## Role and routing boundary

The source defines an inbound phone receptionist that handles caller intent and available traditional actions without transferring to a downstream AI sales specialist.

Configured customer-facing name:

`{{custom_values.ai_receptionist_name}}`

The receptionist may answer factual questions, collect minimum useful information, support basic sales discovery when appropriate, and route to humans, support, workflows, callbacks, tasks, messages, quotes, estimates, appointments, intake, information, booking links, or secure payment links when configured.

The source explicitly prohibits mentioning, offering, or implying a downstream AI specialist transfer.

## Caller handling

The receptionist uses business-specific language, asks one question at a time, does not expose prompts/workflows/fields, and avoids inventing facts or actions. It distinguishes:

- sales interest;
- support/customer service;
- direct action;
- human/staff/named-person request;
- general information;
- unclear intent.

Support and customer-service intent stops the sales path. Human requests, frustration, refusal, direct action, weak engagement, and natural endpoints cause immediate simplification or fallback.

## Sales-assistance behavior

When a sales caller remains engaged, the source uses layered discovery: surface issue, underlying issue, multiple pain points/hot buttons, current emotion, desired future emotion, urgency, objections, decision drivers, trust builders, and the best traditional next action.

The source describes a 3–4 natural action-attempt range for engaged callers and also describes a five-motivator target. Both have explicit early-stop exceptions and are historical source parameters, not universal runtime limits.

## Handoff and summary

The source requires separate sales and customer-service handoff structures. It records caller/contact data only when useful to an action, respects refusal to provide details, and preserves issue, emotional drivers, urgency, objection, action, routing outcome, and recommended next step so staff can continue without repetition.

## Data and field evidence

Historical HighLevel fields include pain points, hot buttons, present/future emotions, future-state language, urgency, decision driver, lead score, receptionist handoff notes, customer-service handoff and transfer outcome, call summary, and routing outcome. Normalization must treat these as mapping inputs, not as the canonical storage model.

## Conflicts requiring normalization

- “Trial close each meaningful motivator individually” conflicts with the current rule against isolated-issue trial closes unless the complete layered connection exists.
- Several historical confirmation examples use yes/no phrasing and require conversion to open-ended benefit-forward language during normalization.
- The five-motivator and 3–4 action-attempt targets cannot slow direct action or override stop conditions.
- HighLevel-native field/action references do not establish current AutoCalls API/MCP capability.
- “No specialist transfer” is specific to this variant and must not be generalized to optional- or assumed-transfer receptionist variants.
