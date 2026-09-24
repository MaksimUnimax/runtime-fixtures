# A04 network correctness — N4 Wildberries quota/header — 2026-09-24

Role: A
Task: A04 / controller subscription-network follow-up
Evidence level: SOURCE + PACKAGE/SYNTHETIC
Installed/live acceptance: NOT CLAIMED

## Trigger

Controller notice `SUBSCRIPTION-NETWORK-REVIEW-20260924` reproduced two independent Wildberries defects on the then-current modules: observed cooldown scope included local `credentialRevision`, so credential rotation split the wait, and the isolated frozen transport exposed only generic `Retry-After`, so WB `X-Ratelimit-Retry` was discarded.

Official WB API documentation (https://dev.wildberries.ru/en/docs/openapi/api-information, checked 2026-09-24 through indexed official content) defines token-bucket limits per documented method/category, gives Marketplace as one seller-account limit across all Marketplace methods, and defines `X-Ratelimit-Retry` on HTTP 429 as seconds until another attempt is allowed. `X-Ratelimit-Reset` is the burst-restoration interval, not the retry deadline.

## Change

- `packages/marketplaces/wildberries/src/adapter.js` keeps the frozen reference transport untouched. At the existing guarded-fetch seam, HTTP 429 now overlays valid `X-Ratelimit-Retry` as the transport's existing retry-after metadata. On WB 429 this header wins over generic `Retry-After`; `X-Ratelimit-Reset` is not interpreted as the retry deadline.
- `packages/marketplaces/wildberries/src/batch-adapter.js` no longer uses credential revision in the observed quota scope.
- Confirmed WB identity uses the catalog's confirmed `providerAccountId`; unconfirmed identity uses stable local `storeId`. Raw token/credential material is never used as quota identity.
- The documented Marketplace category is grouped as `category:marketplace`; other operations stay method-specific unless separately proven broader. This intentionally avoids one coarse host-wide WB block.
- `apps/extension/src/application/runtime.js` supplies only non-secret provider identity state to the WB execution context. Existing execution-context credential/store/work fences are unchanged.

## Safety semantics

- A known 429 still completes the already-dispatched command as a known response; no hidden business-command retry is introduced.
- The observed wait gates later provider dispatch through the existing guarded batch queue.
- Credential rotation cannot bypass an existing observed wait for the same local store.
- Two distinct store cards share a Marketplace-category wait only when both have the same confirmed provider account identity.
- Different confirmed provider accounts remain isolated.
- Unconfirmed store cards do not merge merely because they belong to the same Octoport account or because their credentials have a similar shape; each uses its stable store-local identity.
- Existing worker-generation, Work, binding, credential and UNKNOWN no-replay fences remain authoritative.

## Regression

- `tests/regression/extension-core/wb-adapter.mjs` adds WB 429 header precedence, durable cooldown across credential rotation, confirmed-account Marketplace grouping/isolation, non-Marketplace separation, and conservative unconfirmed store-local behavior.
- `tests/regression/extension-core/application.mjs` proves the actual application/catalog path: two separate WB store cards with the same confirmed provider account share an observed Marketplace-category wait and the second request is blocked before provider fetch.
- Parent Node 24.20.0 focused composed verification: WB adapter PASS 21 scenarios; application PASS including `APP-10b`; zero live provider calls; evidence `/root/octoport-control/logs/A/a04-n4-focused-parent-2`.

## Limits

This candidate does not pre-plan every documented WB method rate interval and does not create a global cross-browser/server quota coordinator. It persists only observed provider waits. Broader groups beyond the officially documented Marketplace example remain method-specific until independently verified. Installed browser and live-provider acceptance remain separate gates.