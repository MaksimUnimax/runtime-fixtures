# C — B18 retention + API semantic/Ozon intake — 2026-09-28

Status: **INTEGRATED SOURCE CANDIDATE / LOCAL ACCEPTANCE PASS / BRANCH CI REQUIRED / NO LIVE RETENTION OR SOURCE UPLOAD**

Base main: `c2e715501161d421b1641bb697c7ee7786d84960` (post-main 5/5 SUCCESS).

## B18 exact intake

C integrated exact B candidate `aa270de338f5ccbdadfc8ff3bd82f07e60513539`. Its effective diff from base is limited to B-owned DB/schema/migration code plus the B18 receipt; no shared contract or C/A product paths are changed.

The candidate adds migration `0052_monitoring_bounded_retention.sql`, bounded compact NO_SESSION state, replay receipts, monotonic watermarks, fail-closed raw-payload GC guards, keyset inventory, minimum 8-day trusted-clock cleanup age, and silent idempotent reconciliation of already-SUCCEEDED legacy NO_SESSION incident processing. It does not replay provider/browser work or emit historical notification intents.

Independent C disposable-PostgreSQL acceptance on exact `aa270de3` was run sequentially to avoid schema-reset test races:
- `health-retention-upgrade.integration.test.ts`: 2/2 PASS;
- `health-no-session-persistence.integration.test.ts`: 7/7 PASS;
- `health-scheduler.integration.test.ts`: 17/17 PASS;
- supervisor `octoport-test-c-3a43ffe55037415281f4674d29db568c.service`: exit 0, OOM 0, cleanup verified, peak 589,299,712 bytes.

C also independently verified DB typecheck PASS, targeted ESLint PASS, targeted Prettier TS/JSON PASS and `git diff --check` PASS. An earlier C multi-file Vitest command is explicitly discarded as invalid acceptance evidence because schema-resetting integration files were allowed to run concurrently; it exited 1 without OOM and was replaced by the successful sequential run above.

No live migration, projection, incident reconciliation, dry-run GC inventory or payload deletion has been performed yet. The already-authorized isolated monitoring pilot rollout remains a separate later step after main acceptance.

## API semantic + Ozon source intake

C applied exact controller semantic-key candidate `bcb2207ad15d1d984935ebce8af32bac1815def8` and the C-owned Ozon acquisition correction. The semantic fix preserves literal payload field names such as `description`, `example` and `examples` when they are actual schema properties/enum/default content, and rebuilds both comparison inventories from accepted bytes to avoid mixed old/new normalizer cache comparisons.

The Ozon correction keeps `API_WATCH_MAX_REDIRECTS=3`, accepted-host fencing, parser/title/server identity checks and generic redirect-limit rejection unchanged. Only a continuous same-origin/same-path Ozon access-control chain `?__rr=1 -> 2 -> 3 -> 4` is classified as `OPERATOR_SOURCE_REQUIRED`; a non-Ozon loop and an Ozon redirect sequence where only the final hop resembles `__rr` remain `INVALID_OFFICIAL_SOURCE_RESPONSE`.

Local parent-tree API-watch acceptance after the B merge:
- 11 test files, **201/201 PASS**;
- typecheck PASS;
- targeted Prettier PASS;
- `git diff --check` PASS;
- supervisor `octoport-test-c-a786172291eb4c3aaf1c5c446e5fbafb.service`: exit 0, OOM 0, cleanup verified.

Live-public pre-intake verification used no cookies, login or credentials. Both canonical Ozon Seller and Ozon Performance docs URLs returned HTTP 307 and were classified by the patched production acquisition code as `OPERATOR_SOURCE_REQUIRED` with the bounded access-control-loop reason. This does not claim authority acceptance or a successful Swagger comparison; it enables the existing durable operator-source handoff instead of falsely marking official authority rejected.

No DB/schema change belongs to the API-watch portion. No operator upload, provider mutation, snapshot acceptance, baseline promotion, Telegram send or live service restart occurred in this intake.

## Branch Coordination release-safety pin

First branch CI on `00c31b425a96d4c986e5387a464a93433a5347e7` failed only the current-repository facts assertion in `tooling/b1/release-safety.test.mjs`: `_journal.json` now correctly ends at migration `0052`, while the test still hard-coded `51`. `productFacts()` intentionally derives the latest repository migration tag; it does not read or rewrite the immutable STORE 0.2.6 authority. C updated only this assertion from 51 to 52. Historical/frozen STORE authority remains migration level 51 and its exact package/backend identities are unchanged. Full release-safety rerun: 42/42 PASS.
