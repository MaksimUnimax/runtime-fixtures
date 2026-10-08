# A04 — provider-neutral response composition

Task: `A04-WB-PROVIDER-NEUTRAL-RESPONSE-COMPOSITION-R2-SCOPE-CORRECTION-20261007`

Original R1: `BLOCKED_SCOPE_INCOMPLETE_VERIFIER`; the R2 task includes the previously omitted verifier regression.

Source base before current-main reconciliation: `fc8a9d064c2b815a6276bc89e2562808c4937d74`.
Current clean parent after no-input-drift check: `2edcaf9f1739eac1562470ec9096987462fd0c7d`.

## Exact source boundary

The existing accepted `provider-response-policy.js`, `provider-response-verifier.js`,
`provider-response-disposition.js`, and `provider-response-retention.js`
are inserted into `apps/extension/composition.json` before the unchanged
`provider-outcome.js`, in that dependency order. There is no change to the
four foundation modules, provider outcome implementation, WB adapter, command
handling, persistence, delivery, provider API access, retry, or UNKNOWN semantics.

The two historical foundation-only differential assertions are updated to
assert that policy and verifier are in composition exactly once in the correct
order, without altering their policy or verifier semantic cases. A new isolated
`provider-response-composition.mjs` regression loads the actual five
committed modules in prelude order, checks frozen globals appear only at their
load step and blocks all mocked external providers/browser/credentials/DB/
service/live-queue operations. The common `extension_core.py` gate includes
this regression before building the source and extracted package variants.

## Initial focused evidence

`/root/octoport-control/logs/A/A04_WB_RESPONSE_COMPOSITION_R2_FOCUSED_20261008.json`
records policy 33 assertions, verifier 32, disposition 14, retention 32,
and composition 27: five focused tests PASS with no provider/browser calls.
Python source syntax and composition JSON parsing also pass.

A full supervised source + extracted extension-core test, independent
exact-candidate review, five required CI and normal task-bound main publication
remain required before claiming completion. These separate gate receipts,
source SHA/tree and final publication readback belong to the task's immutable
publication evidence, not to historical R1 acceptance. This receipt makes
no installed, live-WB, service, provider-policy activation or store claim.
