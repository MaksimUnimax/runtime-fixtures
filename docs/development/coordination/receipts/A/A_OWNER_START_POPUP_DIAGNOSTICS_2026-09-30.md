# A — owner Start / popup diagnostics boundary — 2026-09-30

## Scope

A-owned follow-up for `A_OWNER_START_POPUP_029`.

Frozen store `0.2.9` remains immutable:
- source `74882ec31433ef1840cdea111f2ac6246d5ce3bb`
- Chromium ZIP SHA-256 `f409e35fb714139cc5eefd6c3b390d5d2ca89fb9567a58cb3b68157e1f62eeae`

This change does not alter `popup.css`, live/backend state, marketplace data, authentication authority, Work send semantics, retry/no-replay rules, or frozen `0.2.9` / `0.2.10` packages.

## Reproduction and classification

The owner symptom was real: installed Opera `0.2.9` on an empty ChatGPT page did not visibly enter Work and the support snapshot did not expose a useful Start failure.

A did not accept the first synthetic failure as root cause. Fresh controlled runs on the exact frozen `0.2.9` package showed:
- fresh/new-chat Start -> `active_visible`
- clean existing `/c/` Start -> `active_visible`

The later `WORK_PENDING_BINDING_STATE_INVALID` failure reused synthetic conversation suffix `...0031` with pre-existing binding state/revision and therefore does not prove the owner root cause. The binding revision/intent invariant is preserved.

Evidence:
- `/root/octoport-control/logs/A/owner-start-popup-029-20260930-r1/root-cause-correction.json`
- `/root/octoport-control/logs/A/owner-start-popup-20260930-r1/scenario-fresh-primary.json`
- `/root/octoport-control/logs/A/owner-start-popup-20260930-r1/scenario-existing-primary.json`

The independently proven product gap is diagnostic/feedback:
1. popup `request()` treated any `{ok:true}` Start response as success, including `{ok:true, accepted:false}`, so the UI could end on «Готово».
2. support snapshot / reopened popup had no bounded tab-scoped last Start stage/code/outcome.

## Change

- `SA_WORK_START` popup path now requires `accepted === true`; otherwise it shows a safe actionable reason and never reports «Готово».
- runtime records a sanitized `WORK_START_ACTION_RESULT` with only tab id, bounded stage/code/outcome and no prompt/conversation/store/account data.
- popup/support snapshot derive `lastStart` from existing durable diagnostics, strictly scoped to the requested tab.
- unsupported/unscoped diagnostics are ignored rather than attributed to the current tab.
- popup can present pending/unknown/blocked/failed last Start state after refresh/reopen.
- no automatic retry is introduced.

## Focused validation

Exact Node: `v24.20.0`; pnpm `10.34.5`.

Disposable LOCAL_DEVELOPMENT composition from current A tree:
- version `0.2.10`
- deterministic source/extracted bytes: PASS
- ZIP SHA-256 `c433fd79230b51dd93d511d6a14569281c6703a4d831e158be39aa5992d4767e`

Source and extracted:
- clean HEAD `client-support-snapshot.mjs`: PASS
- `client-start-diagnostics.mjs`: PASS, including `accepted:false`, malformed success fail-closed, tab match/mismatch/unscoped rejection, privacy, and worker reconstruction persistence
- `client-onboarding.mjs`: PASS
- `application.mjs`: PASS, including Work Start/no-replay core scenarios
- provider calls: 0

Resource job:
`octoport-test-a-b5f21c46ca1b4a17a93c5e84ed235f53.service`, exit 0, peak 141 MiB, cleanup verified.

A pre-existing dirty edit in `tests/regression/extension-core/client-i1/client-support-snapshot.mjs` was not authored or modified by this A change. Its added fixture omits `tab_id` while expecting a tab-scoped result, so it fails the new boundary by design. It is preserved outside this commit for its owner to reconcile; A did not weaken tab isolation to satisfy it.

## Evidence levels / limits

Proven here: SOURCE + generated PACKAGE regression for the diagnostics/feedback delta.

Not claimed:
- owner live Start root cause fixed
- genuine ChatGPT response/H3
- native browser-action popup sizing acceptance
- reviewer/store acceptance
- live deployment

L2 separately owns `apps/extension/src/application/popup.css`; A did not edit it.
