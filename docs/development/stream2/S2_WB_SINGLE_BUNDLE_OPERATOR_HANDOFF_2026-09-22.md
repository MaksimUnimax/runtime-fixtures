# Stream 2 — Wildberries single-bundle operator handoff

Status: **ARCHITECTURE AUTHORITY — ACCEPTED DECISION**

Date: 2026-09-22

## Purpose

Wildberries OpenAPI production authority is internally a **13-document source family**, but operator UX MUST NOT require 13 manual downloads, 13 downloaded files, 13 pending requests, or 13 `/swagger_upload` operations.

The permanent operator model is:

```text
13 internal WB OpenAPI documents
→ one normal authorized browser session on dev.wildberries.ru
→ one operator acquisition action
→ browser fetches all 13 official YAML documents in that same session
→ one WB_OPENAPI_BUNDLE_V1 JSON artifact
→ one TG3 pending request
→ one /swagger_upload
→ atomic server validation of all 13 embedded documents
→ 13/13 required for WILDBERRIES authority acceptance
```

The bundle is a transport container only. The 13 YAML documents remain separate source-evidence documents internally.

## Internal required document set

| documentKey | file |
|---|---|
| WB_01_GENERAL | 01-general.yaml |
| WB_02_ITEMS | 02-items.yaml |
| WB_03_ORDERS_FBS | 03-orders-fbs.yaml |
| WB_04_ORDERS_DBW | 04-orders-dbw.yaml |
| WB_05_DBS | 05-dbs.yaml |
| WB_06_IN_STORE_PICKUP | 06-in-store-pickup.yaml |
| WB_07_ORDERS_FBW | 07-orders-fbw.yaml |
| WB_08_PROMOTION | 08-promotion.yaml |
| WB_09_COMMUNICATIONS | 09-communications.yaml |
| WB_10_RATES | 10-rates.yaml |
| WB_11_ANALYTICS | 11-analytics.yaml |
| WB_12_REPORTS | 12-reports.yaml |
| WB_13_FINANCES | 13-finances.yaml |

Official origin: `https://dev.wildberries.ru`.

## Bundle contract

Operator-facing document key:

`WB_OPENAPI_BUNDLE`

Bundle version:

`wb_openapi_bundle_v1`

Expected artifact type:

`JSON`

Operator-facing requirements:

- exactly one pending request ID;
- exactly one downloaded bundle file;
- exactly one upload;
- no per-document operator download/upload loop.

The outer JSON contains exactly 13 rows with:

- `documentKey`;
- `filename`;
- `officialUrl`;
- `httpStatus`;
- exact YAML content.

The bundle MUST NOT contain cookies, browser storage, user identity, marketplace credentials, credential headers, or session values.

## Acquisition boundary

The operator uses a normal visible browser already opened on `https://dev.wildberries.ru/` and completes any normal WB challenge manually.

A same-origin helper may then fetch all 13 official documents in that already-authorized browser context.

Permanent prohibitions:

- no mirror source;
- no Patchright;
- no webdriver masking;
- no anti-bot bypass automation;
- no cookie export;
- no browser-storage export;
- no marketplace credential export;
- no 13 individual browser downloads;
- no 13 operator uploads.

## Atomic validation

One submitted bundle is accepted atomically:

- 12/13 valid → reject the whole bundle;
- 13/13 valid → eligible for `WILDBERRIES AUTHORITY_ACCEPTED`.

Every embedded YAML is independently:

- YAML parsed;
- OpenAPI validated;
- checked for non-empty `paths`;
- SHA-256 hashed from exact document content;
- matched to fixed `documentKey`, `filename`, and official URL.

No partial production authority may be committed from one submitted bundle.

## Family identity

After all 13 documents validate, build a deterministic canonical manifest sorted by `documentKey` with:

- `documentKey`;
- `sha256`;
- `byteLength`;
- `specVersion`.

Compute `FAMILY_MANIFEST_SHA256` from that canonical manifest.

The outer bundle JSON SHA is transport evidence only and MUST NOT replace per-document identities or the family manifest identity.

## Downstream pipeline

After one bundle reaches full authority acceptance, run the existing pipeline:

`A2 → A3 → A4 when a comparable real base exists → A5 → A6 → A7 → A8 → A9 → A10 status/acceptance projection`.

First production snapshot rule:

- store the snapshot;
- build complete inventory;
- do not fabricate a semantic diff when no comparable production base exists.

## Superseded interpretation

Any prior interpretation requiring 13 operator-required downloads, 13 operator pending requests, or 13 operator uploads is superseded by this decision.

The system may still preserve 13 internal document records. Operator UX remains **one bundle, one request, one upload**.


## Implementation receipt — 2026-09-22

Work ID: `S2_WB_SINGLE_OFFICIAL_BUNDLE_HANDOFF_2026-09-22_R1`.

Implementation branch reported by Terminal 2:

`work/stream2-tg3-swagger-handoff-2026-09-22`

Start HEAD:

`d43b5b8496d5cd36742acd530cac2cb4642f2fd4`

End HEAD:

`77918a1ea5f8cd764bf6abe94b8dfb0ad61f7fd3`

Implementation commits:

- `2096265` — `feat(stream2): add single-file wb source bundle`;
- `77918a1` — `test(stream2): verify atomic wb bundle handoff`.

Terminal report states remote push PASS.

### Implemented operator model

Current WB operator handoff is now implemented as:

- one pending request;
- request ID `WILDBERRIES:WB_OPENAPI_BUNDLE`;
- document key `WB_OPENAPI_BUNDLE`;
- expected artifact type `JSON`;
- one browser helper execution;
- 13 official WB fetches inside that execution;
- one downloaded JSON bundle on full success;
- zero downloaded bundle files on any source failure;
- no partial bundle;
- one `/swagger_upload <request_id>`;
- atomic 13/13 validation.

Per-document SHA-256 and deterministic family-manifest SHA logic are implemented. Downstream A2→A10 continuation is implemented but has not yet executed against live WB source authority because no operator bundle has been uploaded.

### Current live source state

All 13 direct server-side WB acquisitions returned HTTP 498 and remain `OPERATOR_SOURCE_REQUIRED`.

Therefore current production authority state remains blocked pending exactly one operator bundle upload.

The exact operator action is:

1. Open `https://dev.wildberries.ru/` in a normal browser.
2. Complete the normal WB challenge if presented.
3. Run `wb-official-bundle-browser.js` once in that already-authorized same-origin browser context.
4. Confirm that exactly one JSON bundle is downloaded.
5. Upload that one file with:
   `/swagger_upload WILDBERRIES:WB_OPENAPI_BUNDLE`.

No individual YAML download/upload loop is permitted.

### Verification receipt

Reported regression:

- API-watch: 157/157;
- A10 acceptance: 4/4;
- monitoring-control: 41/41;
- Telegram operator: 40/40;
- Health: 131/131;
- health-runner: 302/302;
- DB unit/migration: 21/21;
- root typecheck/build/lint/format/docs/bridge/diff checks: PASS.

Security report:

- anti-bot bypass: NONE;
- Patchright: NONE;
- webdriver masking: NONE;
- mirror source: NONE;
- cookie export: NONE;
- browser-storage export: NONE;
- Stream-1 authority mutation: NONE;
- secret leak: NONE.

Database integration remains `ENVIRONMENT_DEFERRED_DATABASE_URL`.

### Current acceptance boundary

Implementation acceptance: **PASS / bounded**.

Production WB source authority: **NOT YET ACCEPTED**.

The next action is operator acquisition and one-bundle upload. Only after a valid 13/13 bundle is accepted may real production A2→A10 continuation run.


## Telegram-only operator UX authority

The human operator surface for this workflow is **Telegram bot only**.

The operator must NOT be required to:

- open a server terminal;
- know repository paths;
- discover or copy a request ID manually;
- run a CLI upload command outside Telegram;
- upload 13 individual files.

The Telegram bot owns the complete operator handoff:

1. The bot exposes one pending WB source task.
2. The bot shows that exactly one bundle is required.
3. The bot provides the browser-helper artifact or the exact helper text/instructions directly in the Telegram conversation.
4. The operator uses a normal visible browser on `https://dev.wildberries.ru/`, completes the ordinary WB challenge if shown, and runs the supplied same-origin helper once.
5. The browser produces one JSON bundle.
6. The operator sends that one JSON file back to the same Telegram bot.
7. The bot binds the attachment to the active `WB_OPENAPI_BUNDLE` pending request automatically. The operator must not manually type or copy the request ID when there is exactly one eligible pending WB bundle request.
8. The bot performs the existing upload/validation pipeline and reports the final authority result.

The low-level `/swagger_upload <request_id>` command may remain as an administrative/debug fallback, but it is NOT the primary operator UX.

If more than one eligible pending upload exists, the bot must present an explicit choice using safe labels; it must not guess.

Current implementation is not considered complete for operator UX until this Telegram attachment flow is live-proven end-to-end.
