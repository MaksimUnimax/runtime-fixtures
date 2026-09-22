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
