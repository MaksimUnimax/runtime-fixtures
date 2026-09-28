# C — Wildberries current item-returns authority — 2026-09-28

Status: **SOURCE + LOCAL PACKAGE VALIDATED; NOT INSTALLED / NOT LIVE / NO PROVIDER CALL**.

## Exact revisions

- Child reviewed commit: `85ea89fe52f9a536901c3e0ce36d5910da99523a`.
- Integrated C commit: `bac8cc88bb58298b07d2235390363aa706abe43a`.
- Child base: `098131b57797be05c844945ad781acc177978e6c`.
- Pre-integration C head: `3e01ceed000ca3a907acfd194cf6e77bd107f31a`.
- Drift on the four edited paths between child base and pre-integration C head: none.

## Provider authority checked by C

Primary source: `https://dev.wildberries.cn/docs/openapi/reports`, read 2026-09-28.

The official Reports documentation marks `GET /api/v1/analytics/goods-return` deprecated and states that it will be disabled on October 26. The documented replacement is `GET /api/analytics/v1/item-returns` with Analytics authorization and required query parameters `dateFrom`, `dateTo`, `status`, `limit`, `offset`; `status` is `active|archive`; documented `limit` range is 0..1000.

## Implementation

- Frozen donor under `migration/reference/**` is unchanged.
- Existing effective-registry overlay keeps both prior retired aliases fail-closed and now adds exactly one current alias: `analytics_item_returns`.
- The overlay refuses the additive bridge if donor `goods_return` drifts from the expected current enabled GET path or if the new alias/path already exists.
- Runtime metadata uses the existing `analytics` host/category, all five query keys are required, body is not required, effect is `READ`, execution remains enabled/current.

## API-watch parity

`tooling/api-watch/src/product-registry.ts` parses the same overlay statically; it does not evaluate the runtime JavaScript. It validates the exact addition shape and values, checks donor `goods_return`, rejects alias/path collision, applies the addition after the two retirements and before the existing FBS overlay, and preserves the donor registry read-only view.

## Independent C validation

- API-watch focused product-registry: **6/6 PASS**.
- `@product/api-watch` typecheck: **PASS**.
- Deterministic development package built successfully; archive SHA-256 `9c50fd122e4fe52a55fdf171d8d2574c1eec9d70e50f10ee927decb4e74f57be`; repeat archive matched and source/extracted bytes matched.
- WB adapter against composed SOURCE: **24/24 PASS**, `live_provider_calls=0`.
- WB adapter against EXTRACTED package: **24/24 PASS**, `live_provider_calls=0`.
- The regression proves `analytics_item_returns` uses the analytics origin, is visible in analytics help without fetch, and rejects omission of each of the five required query keys with `MISSING_QUERY_PARAM`.
- Prettier and `git diff --check`: **PASS**.
- Final supervised validation unit `octoport-test-c-f29269576cf647ef9ad06c9901bffefe.service`: exit 0, OOM 0, peak 128 MiB, cleanup verified.

The first combined run exposed only a test-harness regex mismatch against the existing Russian error wording (`обязателен`); runtime behavior already returned the correct `MISSING_QUERY_PARAM`. The assertion was tightened to stable error code + exact query key and both SOURCE/EXTRACTED reruns passed.

## Boundary

No provider request, browser run, installed acceptance, store upload, live database mutation, deployment, payment, Telegram, or H3 action occurred. The deprecated `goods_return` remains in the effective registry while the official endpoint is still available; its later retirement is a separate authority update, not part of this additive correction.
