# Octoport SEO — M12 corrected source manifest — 2026-09-25 R2

Status: **CURRENT M12 SOURCE AUTHORITY AFTER PROVIDER-FREE CONSISTENCY CORRECTION**

## Correction lineage

Preparation:
`docs/seo/M11_M12_CORRECTION_PREPARATION_2026-09-25_R1.md`
blob `712f7a77789ef01a3c9ce8426eb6185d75b35e2f`.

Current M11 correction acceptance:
`docs/seo/M11_MAIN_CHAT_CORRECTION_ACCEPTANCE_2026-09-25_R2.md`
blob `0fd15af86ba93a6eaae73b43f4507522576f0df3`.

Historical M12 R1 acceptance remains preserved:
`docs/seo/M12_MAIN_CHAT_ACCEPTANCE_2026-09-25_R1.md`
blob `1779d00010f9964ccfefbf1830ee9cd2c75c6b75`.

## Current M12 artifacts

Corrected:
- `docs/seo/M12_PAGE_SPEC_REGISTRY_2026-09-25_R2.tsv`
  blob `53fd8d3217df7b00dbc644a4d396fcd258e497d8`
- `docs/seo/M12_CONTENT_BLOCK_CONTRACT_2026-09-25_R2.tsv`
  blob `b32e4b0c0f8255ef28035a2cf7ce1c804ef9fc10`
- `docs/seo/M12_ADVERSARIAL_DIAGNOSTIC_2026-09-25_R2.tsv`
  blob `4acfd6e0b0171866966c255443509d8825f8f125`

Unchanged and still current:
- `docs/seo/M12_INTERNAL_LINK_CONTRACT_2026-09-25_R1.tsv`
  blob `f35ca60c318efe0c74b2d6219bcb680943560c14`
- `docs/seo/M12_PROOF_TRUST_REQUIREMENTS_2026-09-25_R1.tsv`
  blob `7b5e5a523a877dad3a08343c681ed7a379ec2631`

## Exact corrected HOME contract

```text
PAGE_OWNER_ID = M11PAGE_EXISTING_HOME
URL = https://octoport.ru/
ACTION = OPTIMIZE

H1 =
Подключите ваш ИИ к Ozon и Wildberries

SUBHEADLINE =
Ваш ИИ получает руки для работы с маркетплейсами.

TITLE =
Подключите ваш ИИ к Ozon и Wildberries | Octoport
```

The direct H1 carries the accepted Search/page job.
The previous metaphor remains as brand messaging only and is not an additional target query.

## Analytics contract

The complete analytics page-spec row is byte-equivalent to R1:
- page owner: `M11PAGE_aaa90aa723a3694c`
- planned URL: `https://octoport.ru/seller-analytics`
- action: CREATE
- H1: unchanged
- Title: unchanged
- exact observed query metric: 15
- proof requirements: unchanged.

## External-method basis

Freshly checked before correction:
- https://www.yandex.com/support/webmaster/en/search-results/title
- https://yandex.com/support/webmaster/en/recommendations/presentation
- https://developers.google.com/search/docs/essentials

Project application:
- an existing page with an accepted SEO change is OPTIMIZE;
- the main heading should clearly communicate page purpose;
- search-language terms may be used naturally in prominent page elements when they truthfully describe the page.

## Boundaries

```text
PROVIDER_CALLS = 0
NEW_SEARCH_DEMAND_EVIDENCE = 0
OWNER_SET_CHANGED = 0
CLUSTER_SET_CHANGED = 0
PLANNED_URL_CHANGED = 0
ANALYTICS_SPEC_CHANGED = 0
HOLD_CLUSTER_IMPORT = 0
SITE_MUTATIONS = 0
```
