# Octoport SEO — M1 private Yandex Metrika listCounters release R1

Date: 2026-09-23
Status: **EXACTLY ONE READ-ONLY METRIKA LISTCOUNTERS ACTION RELEASED**

Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation HEAD: `e2398a92520210cf3ffce090967f98fbe88c4aa7`

Parent:
- `docs/seo/technical/M1_LIVE_MEASUREMENT_PRE_STEP_GATE_2026-09-23_R1.md`
- `docs/seo/technical/m1_evidence/2026-09-23/M1_WEBMASTER_LISTHOSTS_SANITIZED.json`
- `docs/seo/technical/m1_evidence/2026-09-23/M1_PUBLIC_LIVE_HTTP_SOURCE_EVIDENCE.json`

## 1. Exact question

Does the currently authorized Yandex Metrika credential contain a counter whose site corresponds to `octoport.ru`?

Public HTML currently contains no Metrika tag, but that alone cannot prove whether a counter/property exists privately.

## 2. Current Bridge capability proof

Current Yandex Marketing Bridge 0.1.9 production source was re-read.

Protocol:
```text
PREFIX = METRIKA_API_V1
RESULT_PREFIX = METRIKA_RESULT_V1
method = listCounters
allowed fields = method,page,perPage,permission
provider request = GET https://api-metrika.yandex.net/management/v1/counters
```

The method is read-only.

## 3. Exact released command

After setting the active Bridge service to `metrika` and saving that active service:

```text
METRIKA_API_V1 {"method":"listCounters","page":1,"perPage":1000}
```

`perPage=1000` is the current protocol maximum and avoids a false no-match caused by ordinary pagination within the first 1000 counters.

## 4. Privacy boundary

The authorized Metrika account may contain unrelated counters/sites.

Therefore:
```text
FULL_RESULT_MAY_BE_RECEIVED_TRANSIENTLY_IN_OWNER_CHAT = true
UNRELATED_COUNTER_ROWS_TO_PROJECT_GITHUB = forbidden
OCTOPORT_MATCHING_COUNTER_ROWS = persist
TOTAL_ROWS / REQUEST STATUS / PROVENANCE = persist
```

Do not persist unrelated counter IDs, site names, owner logins or other private account metadata.

## 5. Outcome interpretation

```text
SUCCESS + OCTOPORT COUNTER:
  -> persist sanitized Octoport counter evidence
  -> remote readback
  -> separately decide whether getCounter / traffic-read is needed

SUCCESS + NO OCTOPORT COUNTER:
  -> METRIKA_READINESS = HOLD_OWNER_SETUP_REQUIRED
  -> no automatic counter creation

AUTH/CREDENTIAL ERROR:
  -> METRIKA_READINESS = HOLD_OWNER_AUTH_REQUIRED

UNKNOWN:
  -> HOLD / no blind retry
```

## 6. Stop rule

No `getCounter`, traffic report, counter creation, tag installation or site mutation is released here.

M1 remains blocked until private readiness is explicitly reconciled.
