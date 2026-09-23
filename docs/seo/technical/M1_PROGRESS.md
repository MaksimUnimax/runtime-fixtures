# Octoport SEO — M1 progress

Date: 2026-09-23
Status: **ACTIVE / PRIVATE WEBMASTER READ CURRENT**
Branch: `seo/wordstat-batch-01-2026-09-16`

## Accepted M1 public evidence

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
PUBLIC_YANDEX_VERIFICATION_META = absent
PUBLIC_GOOGLE_VERIFICATION_META = absent

FIRST_PARTY_RESULT_IN_BOUNDED_PUBLIC_SEARCH_SAMPLE = not observed
THIS_DOES_NOT_PROVE_ENGINE_NONINDEXING = true
```

Public evidence:
- `docs/seo/technical/m1_evidence/2026-09-23/M1_PUBLIC_LIVE_HTTP_SOURCE_EVIDENCE.json`
- `docs/seo/technical/m1_evidence/2026-09-23/M1_PUBLIC_BRANDED_SEARCH_VISIBILITY.md`

## Current private evidence needs

```text
YANDEX_WEBMASTER = OPEN
YANDEX_METRIKA = OPEN
GOOGLE_SEARCH_CONSOLE = OPEN
```

## Current exact action

Exactly one Yandex Webmaster read is released:

```text
WEBMASTER_API_V1 {"method":"listHosts"}
```

Purpose:
- determine whether `octoport.ru` exists in the current authorized Webmaster account;
- obtain exact provider `host_id` if present.

Privacy:
unrelated Webmaster properties must not be persisted into the Octoport project repository.

After the result:
`SANITIZED OCTOPORT PROJECTION -> GITHUB -> READBACK -> then decide getHostInfo or owner setup HOLD`.

No further Webmaster/Metrika action is currently released.

M1 remains OPEN.
M6 final closure remains blocked by M1.
M7 remains BLOCKED.
