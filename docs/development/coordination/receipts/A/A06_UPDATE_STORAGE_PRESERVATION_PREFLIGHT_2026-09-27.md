# A06 — update storage-preservation preflight — 2026-09-27

Status: **SOURCE + PACKAGE PREFLIGHT PASS / REAL STORE N→N+1 STILL OPEN**

Task: bounded continuation of `A06`.
Parent candidate: `8d856db776f5a7915a04cf25b805154c3160bc2f`.
Observed `origin/main`: `7600f3ceb555c32ff798aac48f6c9613e8124ab2`.

## Scope and boundary

The real STORE-3 requirement is unchanged: after a first store installation, A+C must test an actual N→N+1 update of the same distributed package identity and the owner must confirm the Windows update/user experience.

That external store-distribution gate is not available to this A-only source task and is not simulated here.

This preflight closes one independent source/package risk before that gate: an extension `runtime.onInstalled` update event must reconstruct technical wakes without deleting unrelated installation-local data or a future durable scheduler task.
## Existing runtime behavior

The composed application owns exactly one relevant install/update hook in:
`apps/extension/src/application/technical-scheduler.js`

It registers:
`chrome.runtime?.onInstalled?.addListener(() => { void wake("installed"); });`

The application/source tree contains no `chrome.storage.local.clear()` update path.
The imported Ozon worker exposes one `storageRemove()` credential deletion path, but it is called only from the explicit `OZ_CLEAR_CREDENTIALS` command, not from installation/update lifecycle handling.

No product/runtime source was changed in this task.
## Regression

Updated:
`tests/regression/extension-core/client-i1/client-p3-technical-scheduler.mjs`

SHA-256:
`19e2445da041e087671c14ba3b41fe43b5dd424fb409409caaa915e331df8f9c`

The test now captures the real composed worker's `onInstalled` listener, seeds representative unrelated local-state keys:
- `seller_agents_stores_v1`;
- `seller_agents_control_auth_v2`;
- `seller_agents_sync_journal_v1`;

and also schedules a future `TECHNICAL_BUFFER_EXPIRY` task.

It reconstructs a fresh worker context over the same persistent storage, invokes the listener with `reason="update"`, joins the scheduler flight, then proves:
- all three unrelated local-state values are byte-for-byte structurally unchanged;
- the future durable task is unchanged;
- normal scheduler duplicate-wake and payload privacy invariants still pass.
## Verification

Focused source runtime:
- PASS;
- scenarios: 8;
- 100 late/duplicate wake deliveries remain side-effect free;
- `update_storage_preserved=true`.

Focused extracted runtime:
- PASS with the same result.

Supervisor unit:
`octoport-test-a-80ed2c2215c04a07a1b4b8c9082d3540.service`
finished exit 0 with cleanup verified.

Full matrix before final noise-only test formatting minimization:
`python3 tooling/checks/extension_core.py --output /tmp/a06-update-preservation-extension-core-20260927`

The minimization changed no assertion, test data, product/runtime byte, or expected result. The final minimized test bytes were then rerun against both source and extracted runtimes in the focused supervisor job above.

Full-matrix result:
- stage `D2.4`: PASS;
- gate processes: 131;
- live provider calls: 0;
- installed acceptance: false;
- repeat archive match: true;
- source/extracted bytes match: true;
- package SHA-256: `2b3525d5e952b31306828dc173a6a19153e55c2cb59d62dc1048023d158b6530`.
The package SHA-256 is exactly the same as the immediately preceding A04 full matrix:
`/tmp/a04-wb-field-schema-extension-core-20260927/summary.json`

Therefore this task adds test/evidence only and does not create a new product package identity.

## Remaining A06/store gates

Still open and not relabeled:
- real signed/store N→N+1 update of the same distributed package ID;
- owner Windows confirmation of update UX and preservation;
- store-specific permission/update prompts if a future release changes permissions;
- real beta feedback after users exist;
- broader public install/store instructions owned by C/site/reviewer flow.

This receipt is not installed-browser acceptance and not store acceptance.
