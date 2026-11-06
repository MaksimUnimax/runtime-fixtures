# RT-CHECK R01 · bounded runtime-side store checks

This implements the missing private `rt_check_v1` handler. It does not change Engine, SQLite, report-submit gateway, analytics recipes, identity, staff authority or old credential files. The platform keeps secrets in its own vault and sends one transient check request after session validation. This package reads no existing credential directory or runtime configuration.

## Provider checks

- WB: one authenticated GET to `https://common-api.wildberries.ru/api/v1/seller-info`. Identity is the validated UUIDv4 `sid` from the response, namespaced `wb:sid:`. No name, INN or unverified JWT is used. Official reference: https://dev.wildberries.cn/docs/openapi/api-information . The method has account-wide limits; the checker never automatically retries 429.
- Seller: one POST with `{}` to `https://api-seller.ozon.ru/v1/seller/info`, with the supplied Seller `Client-Id`/`Api-Key` pair. The company response is not itself a unique cabinet ID. Promotion is disabled unless the root-controlled `seller_binding_qualified` flag is set after separately proving header-pair binding. Conditional identity is `ozon:client:<normalized numeric Client-Id>`, never company name/INN/OGRN. This inference and its live negative canary remain open; the default returns IDENTITY_NOT_VERIFIED. Official header/error references: https://dev.ozon.ru/start/257-FAQ-spravochnik-oshibok-i-sposoby-ikh-resheniia and https://dev.ozon.ru/news/505-Izmenenie-otdavaemykh-oshibok-sviazannykh-c-API-kliuchami-Seller-API/ . The documented API-key error is not treated as an unconditional specification of the successful header identity binding.
- Performance: one client-credentials exchange at `https://api-performance.ozon.ru/api/client/token`. Even a successful token exchange does not establish the same Seller cabinet, so it cannot promote a revision and returns IDENTITY_NOT_VERIFIED. No JWT decoding, campaign lookup, report or token persistence. Current host reference: https://dev.ozon.ru/news/482-Novyi-domen-Performance-API/ . Same-cabinet proof needs an official identity endpoint/crosswalk.

Known provider failures have separate safe codes. Ozon 403 is not always a missing role: only the documented missing-role message selects SCOPE_MISSING; IP/offer/unknown errors stay unclassified. WB 402 is PROVIDER_PLAN_REQUIRED, not a bad key. No raw upstream text is returned. This package neither purchases access nor enables billing.

## IPC and lifecycle

Exact pins include environment, alisa_market, tenant/store/request UUIDs, provider/kind and positive revisions. Unknown fields, duplicate JSON keys, non-finite numbers, header control characters, wrong product/environment and incorrect kind/provider combinations are rejected before dispatch. The server checks SO_PEERCRED before reading. Both sides use a fixed private socket; an existing path is preserved, never blindly removed.

At most two checks run concurrently. Each request uses a disposable subprocess: secrets enter stdin only, environment is stripped, stdout is the safe response, and stderr is discarded. A timed-out child is killed and reaped, including cases where resolver/socket timeouts are ineffective. The shared HTTPS primitive has no redirects or environment proxy use; ordinary TLS verification is enabled. The request has an overall parent budget of 2.7 seconds and no retries. Service deployment must additionally use native MemoryMax, TasksMax, KillMode=control-group, TimeoutStopSec=5 and private filesystem/network permissions. SIGTERM closes the listener and joins bounded request threads.

All provider kinds are disabled by default. The CLI accepts only explicit kinds, environment and a caller UID. Server configuration is trusted operator input, not browser data. Do not copy observed UID 993/996 into a deployment without fresh readback. Do not grant the platform broad access to alice-lab files merely to make the new socket reachable.

## One shared HTTP primitive

`shared_http.py` is used by both checker and the supplied narrow runtime HTTP extraction patch. The patch is pinned to the R01 archive in `baseline-binding.json`; it keeps analytical qualification/scope checks, recipes, 25-second read, size limit, retry metadata and decoders. Original Engine/worker/tests remain unchanged. Tests replay the complete 800-test baseline with TCP/DNS blocked after applying the patch in an isolated copy.

The compressed baseline under fixtures is an unchanged source-only qualification input recovered from the owner's pinned archive. It is excluded from the runtime package and is never installed or imported by the platform. The working core was newer than that baseline at last readback. Do not apply this patch to a different hash: first obtain fresh working source and rebase under the core owner's scope. No patch has been applied to a running service.

## Qualification and package

`qualify.py --output PATH` runs real loopback TLS and Unix peer checks with owned synthetic credentials. The private CA is explicitly trusted only in test injection; verification is never disabled. `qualify_baseline.py --output PATH` verifies the pinned original archive, applies the exact patch, replays 800 unmodified baseline tests, and records no external provider calls. `build_package.py --source SHA --output DIR` packages the new modules, source hashes and integration patch, excluding fixtures, private inputs and keys.

SOURCE/PACKAGE success is not live marketplace, current-core integration or installed acceptance. The remote-command connection to Alisa was offline on 2026-11-06. Remaining gates are fresh core/device readback, current-source patch integration, peer/service permissions, Seller binding proof, real authorized provider checks and installed customer readback on https://alisa.octoport.ru/app/stores.
