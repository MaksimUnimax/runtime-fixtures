# Octoport SEO — M13 source manifest

WORK_ID: OCTOPORT_SEO_M13_TECHNICAL_SEO_SPEC_2026-09-25_R1
Status: EXECUTION SOURCE MANIFEST / READ-ONLY LIVE BASELINE CAPTURED
Date: 2026-09-25

## Authority identity

- SEO execution base: 15f3e4f69cb54a80b29f268d5da389ca4b1082e9
- frozen current main: 7945d62854e135421c3db003c603187b9f37866b
- branch: seo/wordstat-batch-01-2026-09-16
- applicable LEVEL 2: docs/seo/LEVEL2/M13_M18_IMPLEMENTATION_LAUNCH_MEASUREMENT_RULES.md
- step preparation: docs/seo/M13_STEP_PREPARATION_2026-09-25_R1.md
- input manifest: docs/seo/M13_TECHNICAL_SEO_INPUT_MANIFEST_2026-09-25_R1.json

SEO branch and main were re-fetched immediately before M13 execution and matched the frozen preparation heads exactly.

## Current page/spec authority

- M11 current page-owner correction: docs/seo/M11_MAIN_CHAT_CORRECTION_ACCEPTANCE_2026-09-25_R2.md
- M12 current page-spec correction: docs/seo/M12_MAIN_CHAT_CORRECTION_ACCEPTANCE_2026-09-25_R2.md
- M12 page specs: docs/seo/M12_PAGE_SPEC_REGISTRY_2026-09-25_R2.tsv
- M12 internal links: docs/seo/M12_INTERNAL_LINK_CONTRACT_2026-09-25_R1.tsv
- M12 proof/trust: docs/seo/M12_PROOF_TRUST_REQUIREMENTS_2026-09-25_R1.tsv

## Frozen main implementation source identities

| Path | Blob | M13 role |
|---|---|---|
| apps/site/public/index.html | 3123a714e2092fb156eebe498ef97bb5969567f6 | HOME source |
| apps/site/public/install.html | 99bc456742375219779ae9c611580e389b81c7a1 | service source |
| apps/site/public/privacy.html | bb975f29e3fbe8e1cfeb1fa19f397f9e5dc1f101 | service source |
| apps/site/public/support.html | 2ebb8fdab73c50d98a3af70198f98813cbab942b | service source |
| apps/site/public/robots.txt | 446df898e31b99b230e8a49a7c94a45e4df96228 | crawler policy |
| apps/site/public/sitemap.xml | fdceb2ff477941104373850846c33bac2a5d3ced | sitemap |
| apps/site/public/styles.css | cda70d351cb72332c70d7a32e5b31d3182e0a374 | shared responsive CSS |
| apps/site/README.md | 28442c9c361e64e2fa161281db768a3dc6ca8ecc | site inventory/contract |
| infra/production/nginx/octoport-site.conf | 4efcf08a2c118986496298789bac2565b1067994 | public ingress |
| infra/production/nginx/octoport-apps.conf | adbea6c2d6af15c0ed7bb05af1a7a7e05029d49f | DO-NOT-CHANGE app/api ingress |
| infra/production/scripts/deploy-octoport-site.sh | f35a27b084ddce4cb9342852e5e35579ef0bc6b6 | deployment guard |
| infra/production/scripts/verify-octoport-site.sh | 753782280daa59bd0def52232b23465937f1a880 | live verifier |
| .github/workflows/site-ci.yml | 9c6320dff4f45bf50cc86c1afcdf4893613e374f | source CI |
| tests/regression/site/test_site_deployment.py | 79d5dca16f5fbb26c70450d6b121d59d281ecc69 | deployment regression |

## Fresh read-only live HTTP baseline

Baseline was captured after durable M13 preparation/readback. No server, Webmaster, Search Console, repository, or site mutation was performed.

| Request | Status | Location | Bytes | SHA-256 | Title/H1/canonical/robots observations |
|---|---|---|---:|---|---|
| http://octoport.ru/ | HTTP/1.1 308 Permanent Redirect | https://octoport.ru/ | 164 | 43a81fb3d47b34e7d42d6b8444f592ed9251b8e57db8f67d32419aa40b1480d0 | title=308 Permanent Redirect; h1=308 Permanent Redirect |
| http://www.octoport.ru/ | HTTP/1.1 308 Permanent Redirect | https://www.octoport.ru/ | 164 | 43a81fb3d47b34e7d42d6b8444f592ed9251b8e57db8f67d32419aa40b1480d0 | title=308 Permanent Redirect; h1=308 Permanent Redirect |
| https://www.octoport.ru/ | HTTP/2 308  | https://octoport.ru/ | 164 | 43a81fb3d47b34e7d42d6b8444f592ed9251b8e57db8f67d32419aa40b1480d0 | title=308 Permanent Redirect; h1=308 Permanent Redirect |
| https://octoport.ru/ | HTTP/2 200  | — | 9487 | 2e59af80c28fe74848c96e8869c47bb57ac38a33327d2ae95b7b31e7a9c24127 | title=Octoport — ИИ-сотрудник для Ozon и Wildberries; h1=Ваш ИИ получает руки для работы с маркетплейсами.; canonical=https://octoport.ru/ |
| https://octoport.ru/privacy | HTTP/2 200  | — | 6577 | 42b091e31947414956344fe6a080375944996277eafb22e0af45d4f17682b0d7 | title=Octoport — Privacy; h1=Privacy; canonical=https://octoport.ru/privacy |
| https://octoport.ru/support | HTTP/2 200  | — | 4521 | 20c993f00e923ee5d23b650602c0249eb291571c44e853f6b387d39995c5af71 | title=Octoport — Support; h1=Support; canonical=https://octoport.ru/support |
| https://octoport.ru/install | HTTP/2 200  | — | 2755 | 1fdac0c6ed34c2df7d56bf1e58aa989c7df5e0bb1bb42e9cdc917a2dceea3666 | title=Install Octoport; h1=Install Octoport; canonical=https://octoport.ru/install |
| https://octoport.ru/robots.txt | HTTP/2 200  | — | 65 | a3e53ce760645eba16df505b218e54ef64da0ea0b9c0894ab26a82078418c1a4 | — |
| https://octoport.ru/sitemap.xml | HTTP/2 200  | — | 228 | 9f5ec468d950fe2b28a9e6d45b0626e4bd2d258a7996613d9f763c732392a559 | — |
| https://octoport.ru/index.html | HTTP/2 200  | — | 9487 | 2e59af80c28fe74848c96e8869c47bb57ac38a33327d2ae95b7b31e7a9c24127 | title=Octoport — ИИ-сотрудник для Ozon и Wildberries; h1=Ваш ИИ получает руки для работы с маркетплейсами.; canonical=https://octoport.ru/ |
| https://octoport.ru/privacy.html | HTTP/2 200  | — | 6577 | 42b091e31947414956344fe6a080375944996277eafb22e0af45d4f17682b0d7 | title=Octoport — Privacy; h1=Privacy; canonical=https://octoport.ru/privacy |
| https://octoport.ru/support.html | HTTP/2 200  | — | 4521 | 20c993f00e923ee5d23b650602c0249eb291571c44e853f6b387d39995c5af71 | title=Octoport — Support; h1=Support; canonical=https://octoport.ru/support |
| https://octoport.ru/install.html | HTTP/2 200  | — | 2755 | 1fdac0c6ed34c2df7d56bf1e58aa989c7df5e0bb1bb42e9cdc917a2dceea3666 | title=Install Octoport; h1=Install Octoport; canonical=https://octoport.ru/install |
| https://octoport.ru/privacy/ | HTTP/2 404  | — | 146 | 55f7d9e99b8e2d4e0e193b2f0275501e6d9c1ebd29cadbea6a0da48a8587e3e0 | title=404 Not Found; h1=404 Not Found |
| https://octoport.ru/support/ | HTTP/2 404  | — | 146 | 55f7d9e99b8e2d4e0e193b2f0275501e6d9c1ebd29cadbea6a0da48a8587e3e0 | title=404 Not Found; h1=404 Not Found |
| https://octoport.ru/install/ | HTTP/2 404  | — | 146 | 55f7d9e99b8e2d4e0e193b2f0275501e6d9c1ebd29cadbea6a0da48a8587e3e0 | title=404 Not Found; h1=404 Not Found |
| https://octoport.ru/seller-analytics | HTTP/2 404  | — | 146 | 55f7d9e99b8e2d4e0e193b2f0275501e6d9c1ebd29cadbea6a0da48a8587e3e0 | title=404 Not Found; h1=404 Not Found |
| https://octoport.ru/seller-analytics.html | HTTP/2 404  | — | 146 | 55f7d9e99b8e2d4e0e193b2f0275501e6d9c1ebd29cadbea6a0da48a8587e3e0 | title=404 Not Found; h1=404 Not Found |
| https://octoport.ru/seller-analytics/ | HTTP/2 404  | — | 146 | 55f7d9e99b8e2d4e0e193b2f0275501e6d9c1ebd29cadbea6a0da48a8587e3e0 | title=404 Not Found; h1=404 Not Found |
| https://octoport.ru/m13-definitely-missing-20260925 | HTTP/2 404  | — | 146 | 55f7d9e99b8e2d4e0e193b2f0275501e6d9c1ebd29cadbea6a0da48a8587e3e0 | title=404 Not Found; h1=404 Not Found |

### Live baseline findings that M14 must change

- http://www.octoport.ru/ currently redirects to https://www.octoport.ru/, then HTTPS www redirects to apex: avoidable two-hop host+scheme normalization.
- /index.html, /privacy.html, /support.html, and /install.html currently return 200 with duplicate page bodies instead of redirecting to canonical extensionless routes.
- /privacy/, /support/, and /install/ currently return 404; M13 requires explicit permanent normalization to extensionless service routes.
- /seller-analytics, /seller-analytics.html, and /seller-analytics/ currently return 404, as expected before M14 implementation.
- /privacy, /support, and /install currently have no robots meta directive; M13 requires crawlable noindex, follow.
- HOME currently has historical Title/H1 and must consume accepted M12 R2 targets.
- unknown public URL already returns a real 404; preserve this.
- robots.txt and sitemap.xml return 200; sitemap reflects the pre-M12 one-owner site and must gain only the analytics canonical target.

## Fresh official method sources

| Source | URL | Exact project use |
|---|---|---|
| Yandex canonical | https://yandex.com/support/webmaster/en/robot-workings/canonical | canonical is a recommendation; HTTP/HTTPS moves use redirects; avoid canonical chains |
| Yandex robots.txt | https://yandex.com/support/webmaster/en/controlling-robot/robots-txt | robots restrictions can still leave URLs participating in search; crawlable noindex lets the bot see page-level exclusion |
| Yandex Sitemap | https://yandex.com/support/webmaster/en/controlling-robot/sitemap | sitemap must be reachable and belong to the canonical site |
| Yandex AI | https://yandex.com/support/webmaster/en/yandex-ai | YandexAdditional/YandexAdditionalBot Disallow opts content out of Yandex AI |
| Yandex rendering | https://www.yandex.com/support/webmaster/en/robot-workings/vision | important content must remain accessible to indexing; JS rendering can add uncertainty |
| Google canonicalization | https://developers.google.com/search/docs/crawling-indexing/canonicalization?hl=ru | redirects, sitemap and rel=canonical are canonicalization signals; canonical preference is not absolute |
| Google SoftwareApplication | https://developers.google.com/search/docs/appearance/structured-data/software-app | rich-result eligibility requires name, offers.price and rating or review |
| Google/web.dev CWV | https://web.dev/articles/vitals | good field thresholds at p75: LCP <=2.5s, INP <=200ms, CLS <=0.1 |

## Claim boundary

M13 is a specification stage. Live defects above are observations, not authorization to mutate production. Current-source behavior and desired M14 behavior remain separate. M13 does not claim that deployment, indexing, ranking, Webmaster/GSC ownership, or field CWV are complete.
