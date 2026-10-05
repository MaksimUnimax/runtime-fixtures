# Octoport public site

Status: M14 bounded SEO source implementation candidate / NOT DEPLOYED / NOT INDEXING-ACCEPTED.

## Purpose

apps/site/public/ is the independent public marketing surface for https://octoport.ru/.
It remains separate from apps/portal, apps/admin, apps/api and apps/extension.

The public site remains dependency-free static HTML/CSS. M14 adds no client-side application runtime.

## Canonical and indexability contract

Canonical public origin: https://octoport.ru.

Commercial SEO-owner pages:
- / — connector/category HOME;
- /seller-analytics — bounded seller-owned analytics use case.

Indexable public utility pages:
- /privacy;
- /support.

Crawlable current-status page:
- /install — noindex, follow until an official installation/catalog destination is actually available.

Known .html and non-root trailing-slash aliases are redirect-only. Unknown public URLs remain real 404.

## Search appearance

- HOME carries one static WebSite JSON-LD node for the preferred site name.
- SoftwareApplication, review/rating and invented Organization facts are not published.
- /favicon.png is a 120×120 PNG derived only by deterministic resize from the current accepted Octoport extension mark.
- application/ld+json is non-executable structured data. The only executable public script is the owner-provided Yandex Metrika loader at `public/assets/yandex-metrika.js`; it is shared by all five public HTML pages and adds no site application runtime. It prepares an empty `dataLayer` for the requested Metrika configuration, but the site does not push ecommerce events or custom goals and does not enable Webvisor or form analytics.
- A strict production Content-Security-Policy currently blocks both this loader and the Metrika endpoints. The policy has not been widened in this source change; a security-reviewed policy update must precede deployment.

## Sitemap

public/sitemap.xml contains exactly:
1. https://octoport.ru/
2. https://octoport.ru/seller-analytics
3. https://octoport.ru/privacy
4. https://octoport.ru/support

/install, aliases, assets, portal and API routes are excluded.

## Truth boundary for public copy

Current public copy may state:
- one browser extension connects a user-selected supported AI to Ozon/Wildberries;
- launch scope is read-only data/report analysis and explanation;
- marketplace credentials remain local during ordinary work;
- server still handles account/device/auth and limited service metadata/synchronization;
- closed free beta is being prepared and public access is not yet open.

The site must not claim public paid pricing, automatic business-state mutation, universal browser/provider acceptance, a proprietary Octoport LLM, external market-intelligence coverage without source authority, or a server that stores no data at all.

## Files

- public/index.html — HOME source;
- public/seller-analytics.html — seller-owned analytics use-case source;
- public/privacy.html — indexable privacy utility;
- public/support.html — indexable support utility;
- public/install.html — crawlable noindex installation-status page;
- public/favicon.png — search/browser icon;
- public/styles.css — shared responsive styling;
- public/robots.txt — crawler policy;
- public/sitemap.xml — canonical indexable URL set.

There is no build step. Deployment copies public/ byte-for-byte into a versioned static release and changes only the separately owned public-site nginx config.

## Acceptance boundary

M14 source acceptance is not production deployment. Production deployment, live-route QA and indexing verification belong to later roadmap stages.

The analytics page must not be launched with fake proof. A real sanitized/source-backed product demonstration remains a downstream launch gate.


## Current visual: Contour, owner selection 2026-09-27

The former engraving hero is superseded by the existing working-design variant 2, Contour. Its clean original drawing, eight independent links, separate visible brand/favicon, native theme/menu and self-hosted Rubik are tracked in `docs/design/CONTOUR_INTEGRATION_2026-09-27.md`. SEO metadata, page ownership, beta/read-only copy and utility content are preserved. Contour source tests run in Site CI; source PASS is not production acceptance.

### Contour R2 owner corrections
Transparent scene in both themes, centered equally sized marketplace controls, six colored AI SVGs, magenta/blue marketplace circles, early 1180px stacking with up to 780px illustration below the copy. All eight controls remain independent. Evidence and source/live boundaries: `docs/design/CONTOUR_REWORK_R2_2026-09-27.md`.

Contour R4 follows the owner monochrome references, with independent discs and static foreground grips. R2 stacking and the R3 slogan/heading are retained. Contract and verification: `docs/design/CONTOUR_REFERENCE_R4_2026-09-27.md`; reproducible theme layers: `apps/site/design-sources/build_contour_r4.py`.

### Contour R5 ink match

Contour R5 strengthens only the static illustration ink alpha so the reference-derived raster strokes visually match the exact CSS disc palette (#10243c light / #ebffff dark); button separation and R4 geometry remain unchanged.

### Contour R6 vector scene

The accepted Contour octopus is now rendered from real SVG path geometry rather than raster theme layers. The SVG shares the exact scene color token with the independent DOM controls; foreground WB/Ozon grips remain a separate static SVG layer. Rebuild and acceptance details: `docs/design/CONTOUR_VECTOR_R6_2026-09-27.md`.

R6 fresh-main reconciliation: public tree 4894605f58e35077ba50279b1826f145d68d6d09 remained unchanged while syncing server/monitoring main drift.

### Contour Manual R8

The homepage mascot is hand-authored inline SVG geometry rather than a traced raster. Smooth Bézier tentacles and vector suction cups share the same scene color tokens as the independent DOM controls. Acceptance: `docs/design/CONTOUR_MANUAL_R8_2026-09-28.md`.

### Contour R9

The hero mascot uses a smooth spline SVG reconstructed from the accepted reference silhouette. It preserves the established octopus geometry while removing polygonal raster-edge noise. The eight controls remain independent DOM links. See `docs/design/CONTOUR_SPLINE_R9_2026-09-28.md`.

### Contour R10 exact reference

The homepage mascot is reconstructed directly from the owner-provided 1448×1086 canonical reference, not from the earlier site silhouette. Button holes, positions, diameters, and scene ratio are measured from that reference while all eight controls remain independent DOM links. See `docs/design/CONTOUR_EXACT_REF_R10_2026-09-28.md`.

### Contour R11 full reference

The homepage scene now preserves the full canonical owner reference as a static SVG underlay, including the original circle/tentacle junctions. Eight independent DOM controls overlay the blank reference circles. See `docs/design/CONTOUR_FULL_REF_R11_2026-09-28.md`.

### Contour R12 exact trace

The homepage reference art now uses the canonical owner reference mask directly, without RDP or spline smoothing. The eight interactive circles remain independent DOM links fitted to the same reference geometry. See `docs/design/CONTOUR_EXACT_TRACE_R12_2026-09-28.md`.

### Approved public copy R5

Current copy authority: `docs/seo/SITE_APPROVED_EDITS_2026-09-28_R5.md`. The owner approved native capability disclosure groups, a complete branded HOME H1, Russian product copy and revised analytics/privacy/support pages. The installation instructions remain unchanged. SEO page ownership and indexing directives are unchanged.

### Contour R13 — dark-only owner reference

The 2026-09-29 owner reference supersedes the prior R12 visual for the HOME hero. The public site is now dark-only and the theme toggle is removed. The central octopus/orbit/stars are a static SVG derived from the canonical owner reference, while all eight brand circles remain independent clickable DOM controls fitted to the same reference geometry. See `docs/design/CONTOUR_DARK_OWNER_R13_2026-09-29.md` and `apps/site/design-sources/contour-owner-dark-r13.json`.

### Contour R14 — badge alignment and owner hero copy

The R13 mascot/orbit geometry remains unchanged. R14 normalizes the visible AI mark/label positions, fits Wildberries and Ozon logo/label proportions to the owner reference crops, and applies the 2026-09-29 owner HOME heading/copy correction. All eight circles remain independent links and the scene remains transparent. See `docs/design/CONTOUR_BADGE_ALIGNMENT_COPY_R14_2026-09-29.md`.

### Contour R15 — canonical badge fit

R15 supersedes the R14 badge-layout attempt. Icon/label positions and marketplace proportions are measured from the canonical 2026-09-29 owner reference instead of using one guessed shared offset. The accepted octopus/orbit/circle geometry remains unchanged; the final owner HOME H1 is a single line of meaning, with the provider list moved into the first explanatory paragraph. See `docs/design/CONTOUR_CANONICAL_BADGE_FIT_R15_2026-09-29.md`.

### HERO R16 — cosmic text-first owner reference

The HOME hero now follows the owner-selected cosmic text-first composition: centered live HTML copy, individually colored marketplace/provider names, a CSS-only orbital/horizon background and two live CTA links. The prior R15 octopus/circle hero is no longer rendered on HOME. See `docs/design/HERO_SPACE_R16_2026-09-29.md`.

### HERO R18 — text left, full contour right

R18 restores the complete accepted R15 contour composition (octopus plus eight clickable brand circles) to the right side of the HOME hero while preserving the newer approved text styling on the left. The temporary standalone R17 mascot is removed; the R16 cosmic arcs/pill remain absent. See `docs/design/HERO_R18_TEXT_LEFT_CONTOUR_RIGHT_2026-09-29.md`.

### Browser cards R19 — full-color centered catalogue

The HOME browser catalogue now uses full-color Chrome/Opera/Yandex/Firefox artwork, equal 78×78 browser and Octoport icon boxes, and fully centered 2×2 desktop cards with a centered one-column mobile fallback. See `docs/design/BROWSER_CARDS_R19_2026-09-29.md`.

### Browser cards R20 — original footprint restored

R20 keeps the full-color browser icons, equal 42×42 browser/Octoport icon boxes and centered card content, but restores the exact pre-R19 card footprint and responsive grid. See `docs/design/BROWSER_CARDS_R20_ORIGINAL_FOOTPRINT_2026-09-29.md`.
