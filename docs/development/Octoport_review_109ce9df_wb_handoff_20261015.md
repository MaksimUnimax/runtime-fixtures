# Review main109ce9df: WB handoff recovery and test cleanup

This is the new four-finding task from [the 15 October report](https://github.com/MaksimUnimax/runtime-fixtures/blob/936e5e9172751943caf852a0a7c6e6e9590f3879/review-files/code-review-2026-10-15-109ce9df.md), based on main `109ce9df6145f680dd68687648de9cfb9f64f3b3`. PR97 and its six original findings remain completed.

## Resulting behavior

PostgreSQL artifact sizes are decoded from bigint strings into checked, nonnegative safe integers bounded by the existing upload limit. Authority and snapshot readback use the same strict conversion, so the actual report pipeline can retain strict size and SHA checks.

A ready WB upload wakes the existing monitoring runner. The normal authority pass also discovers durable ready requests, validates the exact quarantine bytes and complete current 13-document registry, then sends those same document bytes through the existing report pipeline. All thirteen authority records commit in one transaction. Stable per-artifact/document identities make recovery idempotent after a lost acknowledgement or a later snapshot/inventory failure. No automatic provider fetch is needed to process the saved bundle. First snapshots retain explicit missing-baseline/NOT_RUN comparison evidence.

Authorized operators can use `/swagger_new` or the existing Swagger keyboard's new WB request button. The action has a fixed WB family, official URL and bundle version; arguments cannot replace that authority. It reuses a competing open request and otherwise creates one explicit generation under the same identity lock as automatic discovery. Terminal history, old candidates and provenance remain unchanged. Generation order is durable and does not fabricate timestamps when the clock moves backwards.

The browser-test cleanup recognizes the standard library's no-handler sentinel after server close. Live handlers, unknown registry state and failed shutdown still prevent disposable-key cleanup. An existing primary failure remains the raised exception, with secondary cleanup failures separately recorded.

## Verification

- Before changes: all 12 focused TypeScript assertions failed on the reported boundaries. The exact old teardown assertion failed with TypeError on a real server with zero requests; a real one-request control passed.
- Local after changes: 527 unique Vitest tests across affected Telegram/API Watch/handoff consumers; 6 Python cleanup tests without any browser launch; changed TypeScript lint and formatting passed.
- Seven native PostgreSQL cases are added for upload/readback/evaluation, strict size/digest negatives, bot-to-report snapshots/inventory, missing comparable base, new database connections and injected persistence failure, all three terminal renewals, concurrent renewal, and atomic thirteen-member rollback/recovery. Their execution is pending CI at this source checkpoint.
- Full Telegram typecheck exceeded the local 320 MiB heap within the fixed 512 MiB service cap. The cap was not increased and the same command was not retried; mandatory exact-candidate Server CI performs the standard full check.
- Intermediate failures and test-fixture corrections remain in the existing Review Fix checkpoint and primary logs, including the initial scheduling-before-defaults setup error and a source-text security assertion's regex false positive.

## Acceptance boundary

Independent exact-candidate review and five mandatory CI remain required before merge. This document does not claim those pending results. CI conclusions and exact SHA receipts are recorded in the existing checkpoint and PR description after completion.

The original review's installed-browser run remains blocked by environment policy: “Loading of unpacked extensions is disabled by the administrator.” No extension-policy change, chrome://extensions operation, alternate browser/role/tool replay, live service/DB change or Tester/R3 takeover was performed. The cleanup tests use real loopback HTTP fixtures and an injected failure before Playwright/browser entry; their PASS is not installed-browser acceptance.
