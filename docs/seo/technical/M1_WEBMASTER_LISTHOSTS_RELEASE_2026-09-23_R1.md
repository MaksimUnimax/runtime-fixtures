# Octoport SEO — M1 private Yandex Webmaster listHosts release R1

Date: 2026-09-23
Status: **EXACTLY ONE READ-ONLY WEBMASTER LISTHOSTS ACTION RELEASED**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation HEAD: `e00604ebc68ae0fc0034fa6c4fb0c8a96676ae6d`

Parent:
- `docs/seo/technical/M1_LIVE_MEASUREMENT_PRE_STEP_GATE_2026-09-23_R1.md`
- `docs/seo/technical/m1_evidence/2026-09-23/M1_PUBLIC_LIVE_HTTP_SOURCE_EVIDENCE.json`
- `docs/seo/technical/m1_evidence/2026-09-23/M1_PUBLIC_BRANDED_SEARCH_VISIBILITY.md`
- `docs/seo/LEVEL1/README.md`
- `docs/seo/EXECUTION_RULES.md`

## 1. Exact question

Does the currently authorized Yandex Webmaster credential contain a property for `octoport.ru`, and if so what exact provider `host_id` must be used for subsequent read-only readiness/indexing checks?

Public reachability cannot answer this.

## 2. Current Bridge capability proof

Current installed-production Yandex Marketing Bridge authority:

```text
version = 0.1.9
source commit = b218afb0187bd26af1d7ada3590b02edc2d4a2de
```

Exact source re-read:
`MaksimUnimax/Yandex_direct@b218afb0187bd26af1d7ada3590b02edc2d4a2de`
`extension/src/shared/webmaster_protocol.js`.

Protocol:
```text
PREFIX = WEBMASTER_API_V1
RESULT_PREFIX = WEBMASTER_RESULT_V1
listHosts allowed fields = method only
request = GET /v4/user/{user_id}/hosts
```

The operation is read-only. It does not add/verify/delete a site, submit a sitemap, request recrawl or mutate Webmaster.

## 3. Fresh official method authority

Current official Yandex Webmaster API documentation confirms that the hosts endpoint returns the sites available to the authenticated Webmaster user and supplies the host identifiers required for per-host calls.

This step uses the list only to locate `octoport.ru` and obtain its exact provider host identity.

## 4. Privacy / persistence boundary

The authorized Webmaster account may contain properties unrelated to Octoport.

Therefore:
```text
FULL_RESULT_MAY_BE_RECEIVED_TRANSIENTLY_IN_OWNER_CHAT = true
UNRELATED_HOST_ROWS_TO_PROJECT_GITHUB = forbidden
OCTOPORT_MATCHING_ROW_AND_MINIMAL_PROVENANCE = persist
ACCOUNTING_FIELDS / REQUEST STATUS = persist
```

This is deliberate data minimization. The project repository must not become a registry of unrelated private sites.

If no Octoport property is present, persist only:
- the fact that the authorized list was successfully read;
- total row count if returned;
- Octoport match count = 0;
- request/provenance/status.

Do not persist unrelated host names.

## 5. Exactly one released command

```text
WEBMASTER_API_V1 {"method":"listHosts"}
```

## 6. Outcome interpretation

```text
SUCCESS + OCTOPORT MATCH:
  -> persist sanitized Octoport row
  -> remote readback
  -> release getHostInfo for exact returned host_id

SUCCESS + NO OCTOPORT MATCH:
  -> Webmaster property/readiness = HOLD_OWNER_SETUP_REQUIRED
  -> no automatic site-add/verification action

AUTH/CREDENTIAL ERROR:
  -> Webmaster credential readiness = HOLD_OWNER_AUTH_REQUIRED
  -> no retry until separately reconciled

UNKNOWN OUTCOME:
  -> HOLD / no blind retry
```

## 7. Stop rule

No `getHostInfo`, summary, diagnostics, indexing samples, verification or mutation is released by this file.

The next action depends on the actual `WEBMASTER_RESULT_V1` and its sanitized persistence/readback.
