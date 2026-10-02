# Development Activation Evidence Material Packet

Status: PLANNING ONLY — NO KEYS, SIGNATURES, SECRETS, OR D1 WRITES

This phase-1 packet defines the six authenticated materials required by the existing activation verifier: maker validation, checker validation, rollback evidence, backup evidence, resource-activation authorization, and Worker-deployment authorization.

The final reviewed runtime-wiring commit is intentionally unset. Maker, checker, and owner principals and public-key IDs are also unset and must be pairwise distinct. Maker continuity applies across maker validation and backup evidence; checker continuity applies across checker validation and rollback evidence; owner continuity applies across both separately identified owner decisions.

Public verification keys may later be stored in the dedicated authority D1 under an exact reviewed execution packet. Private signing keys may never enter the repository, D1, logs, or artifacts and require managed secrets. This packet generates no key, signs nothing, installs no secret, writes no record, changes no binding, deploys nothing, and authorizes no production or customer operation.
