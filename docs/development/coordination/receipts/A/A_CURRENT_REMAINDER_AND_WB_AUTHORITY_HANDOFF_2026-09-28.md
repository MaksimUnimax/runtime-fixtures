# A — current A01–A06 remainder + WB retired-alias authority handoff — 2026-09-28

Status: **LOCAL REMAINDER RECONCILED / WB SHARED-AUTHORITY DECISION REQUIRED / EXTERNAL LIVE+STORE GATES OPEN**

Task: `A_CURRENT_REMAINDER_AND_WB_AUTHORITY_HANDOFF`.

Manual resume receipt:
`/root/octoport-control/incidents/cleanup-handoff-20260928T0131Z/PROMPT_A.md: OWNER_DIRECT_NEW_DIALOGUE_RESUME`.

Fresh A line after ordinary main merge:
- pre-merge A HEAD: `2030d0019ecfcc8d7e092611505141c6d42f9049`;
- accepted main fetched: `779d4b84dd240861b9c96e442970ae03f406bc2d`;
- merged A HEAD before this receipt: `2e4622402338a8dfa0e97b2b6c9790ce5635a5b4`;
- worktree clean; no merge/rebase/cherry-pick/revert in progress;
- incoming main delta since the handoff base was site/design/site-test only, with no extension, marketplace or control-client package-input overlap.

## True A01–A06 remainder

- **A01:** no independent source/package remainder. The pending Work-start map race is fixed and has source/package plus real-Opera installed-synthetic evidence. Broader browser/release evidence belongs to A03/store layers.
- **A02:** closed for the tested A02+B03 protocol scope. Current C06 reconciliation records joint restart/no-replay acceptance; no A-side source defect remains.
- **A03:** current automatable Firefox functional gap is closed by real Firefox 155 installed-synthetic WB+Ozon Work/delivery/no-replay/Finish evidence. Opera installed-synthetic and Yandex Beta development-route evidence also exist. Remaining gates are real branded/store-installed/browser-family or LIVE_OWNER/reviewer evidence, not a known A source defect.
- **A04:** operation-level mapping, bounded field-schema work and deterministic interpretation fixtures are complete for the current source layer. Live provider values/owner gold-set remain external. A separate shared WB authority defect is detailed below.
- **A05:** complete. The repeatedly edited `createPendingWorkStart()` was extracted behind source-SHA guards; differential package/runtime identity and focused regression passed. No independent remainder.
- **A06:** source/package support snapshot, signed update advisory, deterministic legacy import identity and update-storage preservation preflight are complete. Remaining gates are a real signed/store same-ID N→N+1 update, owner Windows UX/preservation confirmation, any future store permission prompt, real beta feedback, and C-owned public reviewer/install flow.

No completed Copy compatibility work is reopened. The accepted Response-actions exclusion remains preserved in current main; old A315/P2 and old CAP24 restore text are stale and were not replayed.

## WB shared-authority defect — existing evidence reused

Existing accepted source receipts:
- `A04_WB_VISIBILITY_MAPPING_REFRESH_2026-09-27.md`;
- `A04_WB_RATING_BOUNDARY_REFRESH_2026-09-27.md`.

Those receipts already prove from the pinned current WB mirror/changelog that:
- `banned_products_shadowed` / `GET /api/v1/analytics/banned-products/shadowed` was removed upstream on 2026-08-15;
- `analytics_item_rating_v1` / `POST /api/analytics/v1/item-rating` was removed upstream on 2026-08-15;
- current business-scenario mappings no longer use either retired alias;
- current replacements/boundaries are used instead, including `banned_products_blocked` and `analytics_item_rating_v2`.

The historical donor remains intentionally frozen:
`migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js`
SHA-256 `08e8a2ad1f325a4bdc0a909b37220b7abaa0be1d94d6b53192666ed5f22c2c75`.

That donor still marks **both retired aliases** as:
`effect="READ"`, `execution_enabled=true`, `current=true`.
## Exact current runtime/package consumers

1. `apps/extension/composition.json` lists the frozen donor first in the `shared/wb_adapter.js` isolated bundle.
2. `tooling/build/extension_composed.py` concatenates every `reference_sources` entry into that bundle and imports `shared/wb_adapter.js` from `service_worker_entry.js`.
3. `migration/reference/wildberries-v0.3.0/runtime/shared/wb_contract.js` accepts any registry operation whose effect is READ and whose `current` and `execution_enabled` flags are true. Both retired aliases therefore pass `resolveOperation()`; with valid required params they reach `buildRequest()`.
4. `migration/reference/wildberries-v0.3.0/runtime/shared/wb_guidance_registry.js` derives guidance from all contract operations. Because both retired rows are still current+enabled, their cards remain READ-safe guidance entries. Their required parameters prevent an empty runnable template, but do not retire or block the operation.
5. `packages/marketplaces/wildberries/src/adapter.js` parses API commands through that contract and its legacy HELP catalog enumerates `Object.keys(C.OPERATIONS)`. The retired aliases are therefore both discoverable/advertised and callable with valid parameters.

Relevant current source SHA-256 values:
- `apps/extension/composition.json`: `11e87d33ce27ea1ce21d079383de95ddef517159757e5d513b7e94981ff9a345`;
- `tooling/build/extension_composed.py`: `d946add7ea5951aaa5034e432511c93ad8c976f24dc8f035e09a2ace5ebf8c14`;
- `wb_contract.js`: `f7bcd6b14d6313374afee77d3ae80ed2d04569996589878c802e236a34a1c60a`;
- `wb_guidance_registry.js`: `44d1bfa4c0cc659fe795678632e89c4e88a71712fe31799422fa608ed750b5f9`;
- `packages/marketplaces/wildberries/src/adapter.js`: `3488db6b61660edfa18add4fff2b17102697117a2acc76f2208c25f8d4c36fdc`.

## Exact 0.2.5 package proof

Authoritative STORE source:
`68f1621376be4d7aeeff44bc76cc326f8cc64954`.

There is **zero package-input diff** from that source through current A HEAD across extension, bridge/AI/browser/control/marketplace packages and both extension build scripts.

Exact prepared Chromium/Opera STORE ZIP:
`/root/octoport-control/logs/C/store-release-68f16213/candidate/OCTOPORT_v0.2.5_CHROMIUM_STORE.zip`
SHA-256 `33cbf1ad9ec4669abe3a65e24cfbaead4c7c3a1fa711261b2d186d107c33aea1`.
The ZIP contains `shared/wb_adapter.js` and `service_worker_entry.js` imports it. Direct inspection of those packaged bytes finds:
- `banned_products_shadowed` with the deleted path and `execution_enabled=true,current=true`;
- `analytics_item_rating_v1` with the deleted path and `execution_enabled=true,current=true`.

Therefore this is a current PACKAGE defect in reference authority, not merely a historical test-fixture string. No provider call was made to prove it.

## C-owned monitoring consumer

`tooling/api-watch/src/product-registry.ts`
SHA-256 `51c3bc32a604245bfa53e91754b1b99b90bda467a097255b4d8d065bf4075011`.

It statically parses the same frozen WB donor. It already applies the effective `fbs_order_statuses` overlay by reading `apps/extension/composition.json`, but there is no equivalent retirement overlay for the two aliases above. They therefore remain effective runtime entries for api-watch as well.

The historical imported regression fixture:
`tests/regression/imported/wildberries-v0.3.0/progress/full_migration_2026-09-13/tests/fixtures/wb024_provider/shared/wb_operations.js`
also contains the stale rows, but it is test history, not the production-input authority. It must not be mistaken for the package root cause.

## Required C decision / bounded implementation ownership

C must choose and record the shared-authority retirement mechanism without rewriting historical donor bytes. The smallest consistent design is an effective-registry retirement layer, ordered after the frozen donor and before contract/guidance construction, that makes both aliases non-current/non-executable (or removes them from the effective registry) while preserving the frozen reference.

The same effective retirement must be visible to:
- composed extension runtime and HELP/guidance;
- `tooling/api-watch/src/product-registry.ts`;
- source/package regression that proves both retired aliases are not advertised as runnable/current and are rejected before any provider request;
- current replacement operations, which must remain unaffected.

C owns the cross-cutting authority/generator decision and api-watch reconciliation. If C assigns the package-side implementation to A, the likely A-owned surfaces are `packages/marketplaces/wildberries/**`, `apps/extension/composition.json` and A-owned extension regressions. A must not edit `migration/reference/**`, DB/schema/migrations, or C-owned readiness/status files without explicit reassignment.

## Evidence boundary

This receipt is SOURCE + exact PACKAGE inspection and ownership handoff only.
It makes no LIVE_WB, LIVE_OWNER, installed-store, deployment, store-submit or production claim.
No cleanup, live provider call, DB mutation, deployment or store action was performed.
