# A04 — WB supply list/status field-schema slice — 2026-09-27

Status: **SOURCE FIELD-SCHEMA SLICE PASS / LIVE VALUES AND FULL-PAGINATION PROOF OPEN**

Task: bounded continuation of `A04_BUSINESS_COVERAGE`.
Parent A head before this slice: `84ae2aa83e3720487301d5ba8a65861576103032`.
Observed `origin/main`: `84c3ba00a2c7f60f17bda414e0292f285cfd734e`.

## Scope

The accepted 45/45 operation mapping remains unchanged.
This slice adds field/status/pagination boundaries for:
- `CAP-07` — supply-order list/status.

No live WB request, marketplace credential, owner session, AI request, deployment, shared readiness mutation or write operation was performed.

## Current official WB sources

Checked on 2026-09-27:
- https://dev.wildberries.ru/openapi/orders-fbw
- https://dev.wildberries.ru/en/docs/openapi/orders-fbs
- https://dev.wildberries.ru/en/release-notes

FBW `POST /api/v1/supplies` uses offset/limit pagination and a required request body. Current docs expose `statusID` values 1..6 for the supply lifecycle.
FBS `GET /api/v3/supplies` instead requires `limit` plus `next`; subsequent pages reuse the response `next` value. Its supply row carries a separate `done:boolean` signal plus timestamps/identity fields.

The 2025-10-02 WB release note confirms the FBW transition to `statusID` / `boxTypeID` identifiers and deprecation of older status/type name fields.

## Machine-readable evidence

Fixture:
`tests/regression/extension-core/fixtures/wb-supply-status-field-schema-slice-v1.json`

Validator:
`tests/regression/extension-core/wb-supply-status-field-schema-slice.mjs`

Coverage importer:
`tests/regression/extension-core/business-scenario-coverage.mjs`

The accepted `business-scenario-coverage-v1.json` mapping remains byte-unchanged.

## Enforced semantics

- FBW `statusID` remains the provider integer enum 1..6.
- FBS `done` remains a boolean scheme-specific state signal.
- The two status systems are not silently collapsed into one vocabulary.
- FBW supply/preorder identifiers remain distinct from FBS string supply IDs.
- Full-list claims require scheme-specific pagination completion.
- FBS response `next` is used for continuation; no undocumented terminal sentinel is invented.
- Missing status or identity remains `INCOMPLETE`; missing values are never interpreted as zero/false.
- Unknown FBW status IDs fail closed instead of being guessed.

## Verification

Targeted:
- `node tests/regression/extension-core/wb-supply-status-field-schema-slice.mjs` — PASS.

Business coverage:
- `node tests/regression/extension-core/business-scenario-coverage.mjs` — PASS;
- 45/45 scenario rows;
- 101 Ozon operation refs;
- 137 WB operation refs;
- 25 deterministic numeric cases;
- accepted readiness semantic projection unchanged.

Full extension-core source/package regression:
- `python3 tooling/coordination/control.py A heavy --profile browser --timeout-seconds 3600 -- env PATH=/root/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin python3 tooling/checks/extension_core.py --output /tmp/a04-wb-supply-status-extension-core-20260927-r1` — PASS;
- resource job `26d26c1bf5b74216a5885c4052aa2010`, exit 0, cleanup verified, OOM kills 0;
- `131/131` source/extracted-package gates PASS.

## Evidence boundary and remaining gates

This is SOURCE/PACKAGE field-schema evidence. It is not LIVE_WB, LIVE_OWNER, store-installed acceptance or final business acceptance.
Still open:
- live WB values and owner gold-set reconciliation;
- full-list pagination terminal proof on real provider responses;
- any owner-required cross-scheme normalization into one business supply-status vocabulary;
- supply-detail field reconciliation beyond the list/status use case.

The FBS documentation specifies how to continue with response `next`, but the surfaced documentation used here does not establish a distinct universal terminal sentinel. The implementation therefore must not declare a complete list merely from one response or an invented sentinel.
