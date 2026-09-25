# Octoport SEO — M13 technical SEO specification — Main Chat QA

Date: 2026-09-25
WORK_ID: OCTOPORT_SEO_M13_TECHNICAL_SEO_SPEC_2026-09-25_R1
Status: **PASS / ACCEPTED / M14 PREPARATION RELEASED / NO SITE IMPLEMENTATION**

## Authority and drift

Preparation SEO head:
15f3e4f69cb54a80b29f268d5da389ca4b1082e9

Frozen main head:
7945d62854e135421c3db003c603187b9f37866b

Immediately before execution and again before QA:
- SEO branch matched its expected remote head;
- main matched 7945d62854e135421c3db003c603187b9f37866b;
- no M11/M12 or implementation-source authority drift was observed.

Applicable LEVEL 2:
docs/seo/LEVEL2/M13_M18_IMPLEMENTATION_LAUNCH_MEASUREMENT_RULES.md

## Publication/readback gate

The first eight M13 execution artifacts were durably published before acceptance QA.

Remote head after those eight artifacts:
0b6b894505268a44bf58c3225fbb6f8545fe146d

Exact remote blob readback:
- M13_SOURCE_MANIFEST.md = 61e826069fbe8980f3f2a55379130c5ea79c9e20
- M13_TECHNICAL_REQUIREMENTS.tsv = c3a858e6b2497150a304fac2b150ebdca44af3cd
- M13_ROUTE_HTTP_CANONICAL_MATRIX.tsv = c78a1163fc8e0cab86a82ad7829dc3c6b3870f3f
- M13_ROBOTS_SITEMAP_INDEXING_SPEC.tsv = 2c61cb5ce940f44f492965d686fc037f255d9659
- M13_METADATA_STRUCTURED_DATA_SPEC.tsv = b1bfe4de817d8f147fb74c99b95e52e440d07dd4
- M13_PERFORMANCE_MOBILE_SPEC.tsv = 38d98f337ab4d784ff8642d7b83d85b33fac4348
- M13_IMPLEMENTATION_FILE_MAP.tsv = 4590155b62c8c15c84474ba21f7eb199ad5ba948
- M13_ADVERSARIAL_DIAGNOSTIC.tsv = 0fdd07524b8f20bba5c65047d409b2077cf145be

Each remote blob matched the exact local Git blob identity. Transport mutation = 0.

## Live baseline

Fresh read-only live baseline was executed only after the durable M13 preparation gate.

Material current implementation observations:
- HTTP apex already goes directly to HTTPS apex;
- HTTP www still goes to HTTPS www first, causing a second redirect to apex;
- HTTPS www directly redirects to HTTPS apex;
- HOME is 200 and self-canonical;
- privacy/support/install are 200 and self-canonical but currently have no robots noindex;
- index.html/privacy.html/support.html/install.html currently return duplicate 200 bodies;
- service trailing-slash variants currently return 404;
- seller-analytics and its aliases currently return 404 because M14 has not created the page;
- robots.txt and sitemap.xml return 200;
- representative unknown route returns a real 404.

These are M14 implementation deltas, not M13 specification failures.

## Full artifact accounting

| Artifact | Data rows | Schema columns | QA |
|---|---:|---:|---|
| M13_TECHNICAL_REQUIREMENTS.tsv | 28 | 10 | PASS |
| M13_ROUTE_HTTP_CANONICAL_MATRIX.tsv | 21 | 12 | PASS |
| M13_ROBOTS_SITEMAP_INDEXING_SPEC.tsv | 9 | 11 | PASS |
| M13_METADATA_STRUCTURED_DATA_SPEC.tsv | 5 | 12 | PASS |
| M13_PERFORMANCE_MOBILE_SPEC.tsv | 13 | 9 | PASS |
| M13_IMPLEMENTATION_FILE_MAP.tsv | 15 | 9 | PASS |
| M13_ADVERSARIAL_DIAGNOSTIC.tsv | 18 | 6 | PASS |

Identity uniqueness:
- requirement_id 28/28 unique;
- route_case_id 21/21 unique;
- surface_id indexing 9/9 unique;
- surface_id metadata 5/5 unique;
- performance check_id 13/13 unique;
- implementation source_path 15/15 unique;
- adversarial test_id 18/18 unique.

TSV width errors = 0.
git diff --check = PASS.

## Hard-gate QA

CURRENT_M11_R2_AUTHORITY = PASS
CURRENT_M12_R2_AUTHORITY = PASS

CANONICAL_ORIGIN_DEFINED = true
INDEXABLE_TARGET_URLS = 2
SERVICE_NOINDEX_URLS = 3
UNKNOWN_ROUTE_404 = required

ROBOTS_POLICY_EXPLICIT = true
YandexAdditional_OPT_OUT = false
SITEMAP_CANONICAL_TARGETS = 2

HTML_ALIAS_REDIRECTS_SPECIFIED = true
TRAILING_SLASH_ALIAS_REDIRECTS_SPECIFIED = true
WWW_CANONICALIZATION_SPECIFIED = true
REDIRECT_LOOP_ALLOWED = false

CRAWLABLE_M11_LINKS = 2/2
ORPHAN_INDEXABLE_TARGETS_ALLOWED = 0

HOME_M12_R2_METADATA_MAPPED = true
ANALYTICS_M12_R2_METADATA_MAPPED = true
FAKE_STRUCTURED_DATA = 0

MOBILE_VIEWPORT_REQUIRED = true
FIELD_CWV_FABRICATION = 0

SITE_CI_UPDATE_REQUIRED = true
DEPLOY_SCRIPT_UPDATE_REQUIRED = true
LIVE_VERIFIER_UPDATE_REQUIRED = true
REGRESSION_TEST_UPDATE_REQUIRED = true

SITE_MUTATIONS = 0
MAIN_BRANCH_MUTATIONS = 0
M14_IMPLEMENTATION = 0

OPEN_CRITICAL_SPEC_DEFECTS = 0

## Adversarial QA

18/18 adversarial scenarios are explicitly closed at specification level.

The diagnostic independently checks, among other cases:
- duplicate .html 200 behavior;
- two-hop HTTP www;
- unmanaged trailing slash;
- missing analytics route;
- service noindex omission;
- unknown-route 404 preservation;
- canonical-only duplicate handling;
- service robots/noindex conflict;
- accidental Yandex AI opt-out;
- analytics orphan risk;
- client-render-only regression;
- fake structured data;
- app/API ingress overwrite;
- fabricated field CWV;
- authority drift;
- stale HOME metadata;
- stale sitemap target set;
- fake analytics proof.

No observed current implementation defect was hidden or relabeled as already fixed.

## Current technical contract

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

Structured data at M14 launch:
NONE unless separately reopened by truthful complete authority.

Application ingress:
infra/production/nginx/octoport-apps.conf = DO_NOT_CHANGE.

## Quality score

1. goal/output completeness = 10/10
2. method/source support = 10/10
3. input evidence/provenance integrity = 10/10
4. coverage/completeness = 10/10
5. analytical correctness/claim boundaries = 10/10
6. adversarial QA quality = 10/10
7. persistence/readback/reproducibility = 10/10
8. owner/client usability/plain language = 9/10
9. information gain/cost/execution efficiency = 10/10
10. downstream readiness = 9/10

QUALITY_TOTAL = 98/100
QUALITY_SCORE = 9.8/10

The two-point deduction reflects that M14 still has a real product-proof dependency for the analytics page and implementation/live verification is intentionally not part of M13.

## Final acceptance

M13_HARD_GATES = PASS
M13_QUALITY_SCORE = 9.8/10
M13_ACCEPTED = true
M14_PREPARATION_ALLOWED = true
M14_IMPLEMENTATION_ALLOWED_FROM_M13_ALONE = false

M13 fulfills its purpose: the technical SEO requirements are current-source-backed, mapped to accepted M11/M12 authority, testable, complete for the bounded launch surface, and durable.

## Next physical action

M14 must begin with its own two-level preparation:
1. fetch current main and SEO authority;
2. read LEVEL 1 and M13-M18 LEVEL 2;
3. reconcile any parallel site/server/extension changes;
4. verify M13 outputs and current Product Truth;
5. close or explicitly gate the analytics real sanitized/source-backed proof requirement;
6. freeze exact implementation files, do-not-change boundaries and tests;
7. persist/readback the M14 preparation;
8. only then authorize bounded production implementation.

M13 itself makes no public-site, nginx, server, Webmaster, Search Console, or main-branch mutation.
