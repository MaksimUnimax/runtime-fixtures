# Octoport SEO — M13 progress

Date: 2026-09-25
Status: **PREPARED / MAIN CHAT EXECUTION READY / M14 BLOCKED**
Branch: `seo/wordstat-batch-01-2026-09-16`

## Cursor

```text
M0..M12 = ACCEPTED
M11/M12 CURRENT AUTHORITY = R2 CORRECTION
M13 = PREPARED / NOT YET EXECUTED
M14+ = BLOCKED
```

## Binding preparation chain

Step preparation:
`docs/seo/M13_STEP_PREPARATION_2026-09-25_R1.md`
blob `131529b1c07d967936aee683a4af14e0cf7bdfe1`.

Input manifest:
`docs/seo/M13_TECHNICAL_SEO_INPUT_MANIFEST_2026-09-25_R1.json`
blob `c4983d38c4650101f2dd984375e9f775988c7324`.

Applicable LEVEL 2:
`docs/seo/LEVEL2/M13_M18_IMPLEMENTATION_LAUNCH_MEASUREMENT_RULES.md`
blob `fe11b327eefff20f6c807581ae947a78c6bcc6e8`.

Current M11:
`docs/seo/M11_MAIN_CHAT_CORRECTION_ACCEPTANCE_2026-09-25_R2.md`
blob `0fd15af86ba93a6eaae73b43f4507522576f0df3`.

Current M12:
`docs/seo/M12_MAIN_CHAT_CORRECTION_ACCEPTANCE_2026-09-25_R2.md`
blob `782f182026172009a220e80a37b9c48e4017be11`.

## Preparation heads

```text
PREPARATION_SEO_PARENT_HEAD = 07ac195167e8e0fe4adfb6a110116e604031b6c2
PREPARATION_MAIN_HEAD = 7945d62854e135421c3db003c603187b9f37866b
```

## Execution mode

```text
WORK_TRIGGER = false
EXECUTOR = MAIN_CHAT
PROVIDER_CALLS = 0
SITE_MUTATIONS_IN_M13 = 0
MAIN_MUTATIONS_IN_M13 = 0
```

## Frozen technical target

Indexable:
- `https://octoport.ru/`
- `https://octoport.ru/seller-analytics`

Crawlable noindex/follow service surfaces:
- `https://octoport.ru/privacy`
- `https://octoport.ru/support`
- `https://octoport.ru/install`

Sitemap target set:
- HOME
- seller-analytics

Yandex AI:
- no YandexAdditional/YandexAdditionalBot opt-out.

Structured data at M14 launch:
- none unless a later explicit truthful authority reopens it.

## Key implementation requirements frozen for M14

- direct canonical HTTPS apex behavior;
- known .html aliases -> canonical extensionless URLs;
- trailing slash aliases -> canonical no-slash routes;
- /index.html -> /;
- unknown URLs -> 404, never HOME;
- add seller-analytics static source + nginx route;
- service pages noindex, follow but crawlable;
- update sitemap/robots;
- preserve app/api noindex ingress and routing;
- crawlable HOME <-> analytics HTML links;
- static initial HTML for critical content;
- update Site CI, deploy source checks, live verifier and regression tests;
- no fake SoftwareApplication/FAQ/review/price markup;
- responsive/mobile/CWV acceptance contract.

## Required M13 execution outputs

1. M13_SOURCE_MANIFEST.md
2. M13_TECHNICAL_REQUIREMENTS.tsv
3. M13_ROUTE_HTTP_CANONICAL_MATRIX.tsv
4. M13_ROBOTS_SITEMAP_INDEXING_SPEC.tsv
5. M13_METADATA_STRUCTURED_DATA_SPEC.tsv
6. M13_PERFORMANCE_MOBILE_SPEC.tsv
7. M13_IMPLEMENTATION_FILE_MAP.tsv
8. M13_ADVERSARIAL_DIAGNOSTIC.tsv
9. M13_QA.md

## First execution action

After this preparation is remote-read back:

```text
FRESH READ-ONLY LIVE HTTP BASELINE
-> apex / www / http redirects
-> HOME
-> privacy
-> support
-> install
-> robots.txt
-> sitemap.xml
-> representative duplicate aliases
```

No server, Webmaster, Search Console or repository mutation.

If live observation cannot be obtained:
`LIVE_BASELINE_UNAVAILABLE`.
Do not infer live state from source.

## Downstream

M14 implementation remains blocked until:
- all nine M13 artifacts exist;
- M13 hard gates PASS;
- Main Chat accepts M13;
- current main is re-fetched for implementation handoff.
