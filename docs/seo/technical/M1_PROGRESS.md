# Octoport SEO — M1 progress

Date: 2026-09-23
Status: **ACTIVE / PRIVATE METRIKA READ CURRENT**
Branch: `seo/wordstat-batch-01-2026-09-16`

## Accepted public evidence

```text
CURRENT_MAIN_HEAD = 5d160f8711c795f71fc4212782813a64bb439513

LIVE_HOME = 200
HTTP_TO_HTTPS = 308 -> 200
WWW_TO_APEX = 308 -> 200

HOME_SOURCE_LIVE_BYTE_IDENTITY = PASS
ROBOTS_SOURCE_LIVE_BYTE_IDENTITY = PASS
SITEMAP_SOURCE_LIVE_BYTE_IDENTITY = PASS

PUBLIC_NOINDEX_OBSERVED = false
X_ROBOTS_NOINDEX_OBSERVED = false
CANONICAL = https://octoport.ru/

LIVE_METRIKA_TAG = absent
LIVE_GA_GTM_TAG = absent
```

## Yandex Webmaster

```text
LISTHOSTS = OK / HTTP 200
AUTHORIZED_HOST_COUNT = 1
OCTOPORT_MATCH_COUNT = 0
UNRELATED_HOST_DETAILS_PERSISTED = false
YANDEX_WEBMASTER = HOLD_OWNER_SETUP_REQUIRED
```

Sanitized authority:
`docs/seo/technical/m1_evidence/2026-09-23/M1_WEBMASTER_LISTHOSTS_SANITIZED.json`

No automatic site-add or verification action is authorized.

## Current exact next action

First set and save active Bridge service:
`metrika`

Then exactly one read-only command is released:

```text
METRIKA_API_V1 {"method":"listCounters","page":1,"perPage":1000}
```

Privacy:
unrelated counters/sites must not be persisted into the Octoport project.

After result:
`SANITIZED OCTOPORT PROJECTION -> GITHUB -> READBACK -> determine Metrika readiness`.

## Still open

```text
YANDEX_METRIKA = OPEN
GOOGLE_SEARCH_CONSOLE = OPEN
M1 = OPEN
M6_FINAL_CLOSURE = BLOCKED_BY_M1
M7 = BLOCKED
```

Authorities:
- `docs/seo/technical/M1_LIVE_MEASUREMENT_PRE_STEP_GATE_2026-09-23_R1.md`
- `docs/seo/technical/M1_WEBMASTER_LISTHOSTS_RELEASE_2026-09-23_R1.md`
- `docs/seo/technical/M1_METRIKA_LISTCOUNTERS_RELEASE_2026-09-23_R1.md`
