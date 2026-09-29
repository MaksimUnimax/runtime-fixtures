# C03 API-watch document-scoped recovery — SOURCE acceptance

Date: 2026-09-29
Role: C
Base main: fccdc3ead510deddb8f05614350c161adf1565ca

## Scope

This source change fixes false product/API incident recovery across sibling documents. Product crosswalk rows and product incidents persist nullable `documentKey`; scoped product incident identity includes a bounded SHA-256 document suffix. Product recovery requires verified accepted-baseline NO_CHANGE evidence for the same source family and exact document. Missing/null/sibling scope stays fail-closed. Acquisition recovery remains separate.

B migration 0055 source commit `02fe73d9ae199d9e4803632f7890e1a13b917536` is already in current main. This receipt does **not** authorize or claim live migration 0055.

## Exact verification on current main

- `@product/api-watch`: 12 test files / 228 tests PASS.
- `@product/api-watch` typecheck PASS.
- ESLint on all 7 changed C03 source/test files PASS.
- Prettier check PASS after formatting the prepared patch.
- `git diff --check` PASS.
- Real PostgreSQL disposable C DB: canonical migrations applied; `document_key` exists on `api_watch_product_crosswalk` and `api_watch_incidents`; actual Postgres crosswalk store and incident store round-trip `documentKey=seller-v2`; scoped incident key contains `:DOCUMENT_SHA256:`; own probe rows cleaned.
- Resource receipts: focused `0e2418c2fe1b48c9b20950e5f031eaa8` exit0/OOM0/cleanup; real-PG `4e3debdf5df14287a5ed82150c1297f6` exit0/OOM0/cleanup.

## Limits

SOURCE/DISPOSABLE only. No live 0055, no live incident reconciliation, no production deployment, no second Telegram poller. `runApiWatchReport` production caller remains intentionally unwired to crosswalk rows at this slice.
