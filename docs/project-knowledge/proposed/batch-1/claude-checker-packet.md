# Independent Claude Checker Packet — Batch 1

Status: CHECKER REQUEST — REVIEW THE EXACT COMMIT, NOT THIS MAKER SUMMARY

Candidate commit: use the immutable Draft PR #3 head SHA supplied in the reviewer request and recorded in the PR description. Refuse a branch name or moving target.

Claude must independently inspect the complete Batch 1 source package, the independent review exports, and the reconciled normalized outputs at that exact commit. Prior internal checker work is evidence only and must not be represented as Claude approval.

## Required checks

1. Verify every normalized statement is supported by cited Batch 1 source or explicit current user direction.
2. Identify omissions, inventions, collapsed information classes, and lost historical conflicts.
3. Confirm all 19 machine records are `PROPOSED`, have `governing: false` at both package and record level, and cannot satisfy the runtime's `FINAL`/`CURRENT` requirement.
4. Confirm $177/$247 pricing, included/unlimited-minutes claims, GHL Voice AI runtime assumptions, Matt direct-inbound framing, short/yes-no trial closes, and shared production D1 remain only as historical evidence; confirm no unverified commercial candidate is treated as CURRENT.
5. Confirm $197/$297 pricing is explicitly unverified and PROPOSED; confirm CRM-read-first, layered emotional selling, high-intent/frustration overrides, Kelly→Matt website flow, two-tier discovery provenance, normalized entities, and dedicated Worker/D1 isolation for every production customer are represented accurately. Separately confirm service authentication without OAuth remains an implementation constraint outside the 19 Batch 1 source-derived records.
6. Confirm no credentials, tokens, private keys, credential fields, or secret material enter source, proposed knowledge, or evidence.
7. Review the missing-material register and classify each item as blocking finalization, implementation, deployment, or production.
8. Report findings by severity with file and section evidence.
9. Run repository validation and secret scanning available at the candidate commit.

## Required terminal result

Return exactly one terminal line:

- `CLAUDE CHECKER: BATCH 1 NORMALIZATION ACCEPTED`
- `CLAUDE CHECKER: BATCH 1 NORMALIZATION REQUIRES CORRECTION`

Acceptance applies only to the exact reviewed commit. It does not authorize merge, promotion to `CURRENT`/`FINAL`, deployment, external writes, production activation, customer-data operations, calls, messages, or campaigns.
