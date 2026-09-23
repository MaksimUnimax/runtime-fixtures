# Octoport SEO — M1 public branded/search visibility observation — 2026-09-23

Status: **BOUNDED PUBLIC SEARCH OBSERVATION / NOT ENGINE-OWNERSHIP AUTHORITY**

Executed after:
`docs/seo/technical/M1_LIVE_MEASUREMENT_PRE_STEP_GATE_2026-09-23_R1.md`

Queries checked through the current external web-search surface:
1. `"octoport.ru"`
2. `"Octoport" "Ozon" "Wildberries"`
3. `"Октопорт" Ozon Wildberries`
4. `site:octoport.ru Octoport`

## Observed

No first-party `octoport.ru` result was returned in the surfaced result set for these four probes.

A third-party analyzer result was surfaced:
- `https://yapl.ru/wrd/octoport.ru/`
- its crawled page lists current Octoport/Ozon/Wildberries vocabulary from `octoport.ru`.

For the Cyrillic brand term, an unrelated historical Bulgarian technical-device result using `ОКТОПОРТ` was surfaced:
- `https://mtc-aj.com/library/45.pdf`.

## Interpretation

```text
FIRST_PARTY_RESULT_OBSERVED_IN_THIS_PUBLIC_SAMPLE = false
THIRD_PARTY_CRAWL_OF_OCTOPORT_RU_OBSERVED = true
CYRILLIC_BRAND_COLLISION_OBSERVED = true
```

Claim boundary:

This does **not** prove:
- Yandex index exclusion;
- Google index exclusion;
- Yandex Webmaster URL state;
- Google Search Console URL Inspection state.

Search-backend coverage and ranking are not the same as owned engine index authority.

The authoritative M1 indexing/readiness question remains:
- Yandex Webmaster owned state;
- Google Search Console owned state.

This public observation is retained only as a branded visibility baseline.
