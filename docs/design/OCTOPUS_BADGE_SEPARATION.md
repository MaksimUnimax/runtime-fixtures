# Octoport engraving integration R2

Status: PRODUCTION ACCEPTED / LIVE BROWSER-QA PASS.

## Scope
- working-design visual system is integrated into the real site source;
- engraving variant 3 is the hero illustration;
- Rubik is the selected font;
- light/dark theme remains CSS-only;
- six AI marks are independent links;
- Wildberries and Ozon are independent badges;
- no moving badge contains octopus/tentacle/background pixels.

## Corrected layering
1. assets/engraving-3-underlay.webp is a clean transparent eight-tentacle engraving with no badges and no rectangular holes.
2. Underlay SHA-256: 7461105df20de2760d111c2ee25a4d741969fc03131f6e4dc9026012acded27d.
3. Underlay is 1024x1024 WebP with alpha, rendered via object-fit: contain.
4. Orbit is a separate CSS decoration behind the underlay.
5. Six AI glyphs are independent assets inside independent DOM badges.
6. Wildberries/Ozon are independent color DOM badges.
7. Hover/focus transforms only the badge element; the engraving underlay has pointer-events:none and never transforms.
8. Light theme uses a light scene and light AI badges; dark theme uses a black scene and dark AI badges. Marketplace colors stay branded.

## Regression that this fixes
The prior R1 underlay still contained black rectangular patches where Wildberries/Ozon had been removed. A hover could expose those patches. R2 replaces the underlay itself, rather than masking the defect.

## Browser QA
- Chrome 1440 light/dark: PASS.
- Chrome hover: 8/8 independent badges move; underlay geometry unchanged.
- Explicit WB/Ozon before/after hover screenshots: PASS, no rectangular hole/duplicate remains.
- Chrome 390 light/dark: PASS, no horizontal overflow.
- Chrome 320 light/dark: PASS, scrollWidth == clientWidth == 305.
- Opera desktop source/render probe: PASS.
- Yandex desktop source/render probe: PASS.
- H1/Title/SEO canonical contract preserved.

Predeploy evidence:
- /root/octoport-control/design/engraving-preview-r2/hover-mobile.json
- /root/octoport-control/design/engraving-preview-r2/*.png
- /root/octoport-control/design/engraving-preview/opera-r2-probe.json
- /root/octoport-control/design/engraving-preview/yandex-r2-probe.json

Live evidence:
- /root/octoport-control/logs/site-design-acceptance-20260927-r2/

## Current SEO preserved
- exact accepted HOME Title/H1/description/canonical;
- WebSite JSON-LD;
- /seller-analytics, /privacy, /support, /install;
- sitemap/robots/indexability contract;
- zero executable JavaScript.

## Production acceptance
Deployed source: 2000908334d0e77c7b19602bfb84294f9b11dafe.

Production verifier, live Chrome/Opera/Yandex checks, light/dark hover checks, 320/390 responsive checks and utility-page browser checks all pass. The prior foundation visual is superseded by this engraving integration.
