# Octoport SEO — M13 progress

Date: 2026-09-25
Status: **ACCEPTED / M14 PREPARATION RELEASED / M14 IMPLEMENTATION NOT YET AUTHORIZED**
Branch: seo/wordstat-batch-01-2026-09-16

## Cursor

M0..M12 = ACCEPTED
M11/M12 CURRENT AUTHORITY = R2 CORRECTION
M13 = ACCEPTED
M14 = PREPARATION ALLOWED / IMPLEMENTATION NOT YET STARTED
M15+ = BLOCKED

## Binding M13 authority

Preparation:
docs/seo/M13_STEP_PREPARATION_2026-09-25_R1.md

Input manifest:
docs/seo/M13_TECHNICAL_SEO_INPUT_MANIFEST_2026-09-25_R1.json

Execution outputs:
1. docs/seo/M13_SOURCE_MANIFEST.md
2. docs/seo/M13_TECHNICAL_REQUIREMENTS.tsv
3. docs/seo/M13_ROUTE_HTTP_CANONICAL_MATRIX.tsv
4. docs/seo/M13_ROBOTS_SITEMAP_INDEXING_SPEC.tsv
5. docs/seo/M13_METADATA_STRUCTURED_DATA_SPEC.tsv
6. docs/seo/M13_PERFORMANCE_MOBILE_SPEC.tsv
7. docs/seo/M13_IMPLEMENTATION_FILE_MAP.tsv
8. docs/seo/M13_ADVERSARIAL_DIAGNOSTIC.tsv
9. docs/seo/M13_QA.md

Applicable LEVEL 2:
docs/seo/LEVEL2/M13_M18_IMPLEMENTATION_LAUNCH_MEASUREMENT_RULES.md

## Execution facts

PREPARATION_SEO_HEAD = 15f3e4f69cb54a80b29f268d5da389ca4b1082e9
FROZEN_MAIN_HEAD = 7945d62854e135421c3db003c603187b9f37866b
FIRST_8_OUTPUT_REMOTE_HEAD = 0b6b894505268a44bf58c3225fbb6f8545fe146d

WORK_TRIGGER = false
EXECUTOR = MAIN_CHAT
PROVIDER_CALLS = 0
SITE_MUTATIONS_IN_M13 = 0
MAIN_MUTATIONS_IN_M13 = 0

M13_REQUIREMENTS = 28
M13_ROUTE_CASES = 21
M13_INDEXING_SURFACES = 9
M13_METADATA_SURFACES = 5
M13_PERFORMANCE_CHECKS = 13
M13_IMPLEMENTATION_FILE_ROWS = 15
M13_ADVERSARIAL_TESTS = 18

OPEN_CRITICAL_SPEC_DEFECTS = 0
QUALITY_SCORE = 9.8/10
M13_ACCEPTED = true

## Frozen launch technical target

Indexable:
- https://octoport.ru/
- https://octoport.ru/seller-analytics

Crawlable noindex,follow:
- https://octoport.ru/privacy
- https://octoport.ru/support
- https://octoport.ru/install

Sitemap:
- HOME
- seller-analytics

Yandex AI:
- no YandexAdditional/YandexAdditionalBot opt-out.

Structured data:
- NONE at M14 launch unless later truthful authority explicitly reopens it.

## Confirmed current implementation deltas for M14

- HTTP www has avoidable two-hop normalization.
- current .html aliases return duplicate 200 bodies.
- current service trailing-slash variants return 404 instead of canonical redirects.
- seller-analytics is not implemented yet.
- service pages lack noindex,follow.
- HOME still carries historical pre-M12 R2 Title/H1.
- sitemap is still pre-analytics.
- Site CI/deploy/verifier/regression guards still know the old site surface.

Preserve:
- unknown route real 404;
- static initial HTML architecture;
- security/cache headers;
- separate app/API ingress;
- app/API X-Robots noindex behavior;
- deployment rollback and application-ingress integrity guards.

## Next step

M14 does not start from this file alone.

Next physical action:
M14 STEP PREPARATION under live LEVEL 1 + M13-M18 LEVEL 2, with fresh current-main and parallel-work reconciliation.

Only after M14 preparation is persisted and remote-read back may bounded public-site implementation be authorized.
