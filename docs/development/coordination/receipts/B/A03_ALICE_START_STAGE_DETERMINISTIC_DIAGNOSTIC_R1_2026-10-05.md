# A03 Alice Start deterministic stage diagnostic — 2026-10-05

## Result

Verdict: **PASS_DIAGNOSIS** at **SOURCE_LOCAL_CONTRACT** only.

Current verified main: `d2b4637628b1a8a4537757fd18eeb9d4683e8873`.

Accepted common Start source: `86d1573ea48493336d06773c77d86cee3d76e244`.

Preserved installed-synthetic Alice failure source: `6311d021223d1839f78b5d5861c632028e5ebb61`.

Classification: `TEST_FIXTURE_RESPONSE_GATE_INCAPABLE`.

Preserved failed-run stage: `UNPROVEN_AFTER_IDENTITY_CONFIRMATION`.

Deterministic contract stage: `response_gate_requires_new_complete_assistant_turn_fixture_never_creates`.

## Evidence-bound diagnosis

The single preserved owner-authorized Alice installed-synthetic retry confirmed Alice conversation identity and later timed out waiting for `active_visible`. The failed-run evidence does **not** prove that the fixture Send hook fired, that the content watcher reached the response gate, or which later runtime stage was reached.

The exact executed fixture is preserved at `/root/octoport-control/logs/A/a03-alice-universal-binding-installed-parity-r1-20261005/WIP_browser_conversation_binding_alice.py` with SHA-256 `171c58ee74b26a4812d877f135c6a444450c02a424b2832318368ab66a5510fb`. Its Send hook appends a new **user** turn, records the sent text, and clears the composer. That exact hook contains no code path that creates a new Alice assistant turn.

Current content runtime deliberately waits for a new assistant message that was absent from the pre-send baseline and reports `first_response_complete=true` only when that assistant turn exists and is complete. Current worker logic remains waiting while `first_response_complete !== true`; binding and transition to `ACTIVE_VISIBLE` happen only after the response-complete condition is satisfied.

Therefore the deterministic source check establishes a **fixture limitation consistent with the preserved timeout**, not the cause of that historical timeout. It does not establish a product source defect and it does not establish the exact failed-run stage after identity confirmation.

The current worker-level regression still contains the WB/Alice historical-unbound Start case and expects final `active_visible`. Extension/runtime inputs have not changed between accepted owner Start source `86d1573e...` and current main `d2b46376...`.

Deterministic diagnostic:
- test SHA-256: `4567eb8b96dabfb692e8d070eab0374c49e7cc6573c6f3d7d849afede98bedc0`
- result SHA-256: `31e2530af0e45e521bc533a9bef981571b03e45b476ecc0a5771072eac6d619d`
- executed fixture SHA-256: `171c58ee74b26a4812d877f135c6a444450c02a424b2832318368ab66a5510fb`
- result: `PASS`

## Required successor acceptance

Do not rerun the consumed Alice owner-authorized retry.

A separate installed-synthetic successor must make its synthetic Alice surface produce exactly one new complete Alice assistant response after the one-shot Start send and then exercise the real installed MV3 lifecycle under a separately governed browser acceptance. Product runtime must not be changed merely to make the old incomplete fixture pass.

## Non-claims

This receipt does not claim:
- that the fixture limitation caused the preserved timeout;
- which runtime stage the preserved failed run reached after identity confirmation;
- INSTALLED_SYNTHETIC Alice PASS;
- LIVE_OWNER or provider-live Alice behavior;
- marketplace-live behavior;
- deployment or production readiness;
- that a second browser retry is authorized;
- that the product runtime needs a fix.

No provider, marketplace, DB, service, browser, or live network action was performed by this diagnosis.
