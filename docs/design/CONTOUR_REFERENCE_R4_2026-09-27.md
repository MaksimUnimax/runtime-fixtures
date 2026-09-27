# Contour R4 — owner reference matching, independent controls

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.
Base: 24571c392b0c01359887019e6d23f3363d830f69.

## Owner scope
The first two owner screenshots are the reference; the third and fourth are the old live scene. Match monochrome circles, marks, tentacles and their visual junctions in both themes. This supersedes R2 colored scene marks and R3 blue-lavender circle accents, but not the R3 slogan or brand colors in the H1. The task is a website code change, not image generation.

## Implementation
- Static detailed linework is deterministically recovered from the supplied dark reference, crop (30,58)-(589,477), canvas 559 by 419. The reference contains the original broken orbit arcs, endpoint dots and stars; the separate continuous ellipse is removed.
- The light palette is navy #10243c; the dark palette is pale #ebffff. The scene remains transparent and the discs use the page background, including dark-filled discs in dark mode. No white dark-mode buttons, marketplace color panels or neon rings.
- Eight real circular links contain only independent vector marks and live text. No reference crop, tentacle, underlay or grip is inside a link. Existing destinations, labels and keyboard navigation remain unchanged.
- Complete badge discs are erased from the static reference alpha. Removing all buttons reveals the octopus and support arms, not duplicate rings or logos.
- Two small, shaped static foreground grip patches reproduce the curled lower arm ends across the WB/Ozon disc edges. These patches are outside all links, pointer-events:none, and do not transform on hover/focus. No rectangular crop boundary is shown.
- Shared normalized coordinates keep the linework, fingers and discs aligned at every width. Hover scales only the disc slightly; both static theme layers and foreground fingers remain stationary. Reduced motion remains supported.
- Small phone circles keep reference proportions; independent pseudo-element hit areas retain a 44px minimum target without enlarging artwork.
- Cache identity is contour-20260927-r4 across all five pages. New asset names prevent stale R2 colored marks from being reused.

## Preserved boundaries
Slogan below the art, heading text and heading brand colors, Title/description/canonical, utility copy, favicon/header logo, native theme/menu, no executable JavaScript, no new tracking, no beta opening or feature claims. Tablet stacking remains at 1180px; a 960px viewport retains a 780px scene below the text. Backend, extension, application ingress and the unrelated A/B/C work are untouched.

## Reproducibility and source checks
`apps/site/design-sources/contour-reference-r4.json` records alpha, mark and layer hashes. `build_contour_r4.py` rebuilds the two theme underlays and shaped grips from checked compressed alpha (Pillow required). This is a screenshot-derived asset, not a claim that the unavailable original high-resolution source was recovered.

14 source tests and 13 deployment regression tests PASS. The complete Site CI inline metadata, links, copy and no-JavaScript checks PASS. The updated tests enforce the newly requested monochrome palette rather than the explicitly superseded R2 color requirement.

Real Chrome/Opera/Yandex source browser run: 102 render/theme/utility states PASS and 48 independent hover/focus pairs PASS. Widths 1778,1440,1232,1181,1180,1100,1024,960,900,820,768,760,640,390,320. No horizontal overflow; all marks load; marketplace labels/slots stay centered; slogan/heading and native menu/theme remain functional. Six visible AI marks use the exact theme palette; both marketplaces use uncolored page-matching fills.

16 screenshot corner checks PASS. Visual inspection includes light/dark, the lower grip junctions and the scene with every button hidden. Source evidence: /root/octoport-control/design/contour-r4-source/.

Source acceptance does not stand in for exact-head CI or live deployment. Record the deployed SHA and live checks below after publication.

## Production acceptance — 2026-09-27

Deployed source: `917d47ea85516b992c96ab17242698419c539dc5`.
Previous live source: `714f674dc269ea115d6e6d2233b8740f36847367`.
Fresh remote main before integration: `24571c392b0c01359887019e6d23f3363d830f69`; no intervening main change. Non-force integration and exact remote readback completed.
Exact-head Site CI `36321956165` and Site Deploy CI `36321956121`: SUCCESS.
Rollback-safe repository deployment PASS; public-site verifier PASS including TLS, inherited security headers, redirects and unchanged application/API boundaries. Backup: `/var/backups/octoport-site/20260927T132003Z`.

Live HTTP: 30/30 no-redirect resource checks and exact source-byte comparisons PASS, including all five pages, CSS, favicon, robots/sitemap and all 20 R4 assets.
Live Chrome/Opera/Yandex: 30/30 render/theme/utility states and 48/48 independent hover/focus pairs PASS. Full 102-state source run covers the breakpoint edges. Browser resource group peak 597 MiB, exit 0 and cleanup verified.

Live visual review: desktop both themes, 960px full-width scene and 320px complete viewport captures. Both mobile themes show the complete illustration below the text and the slogan below the illustration. Some CDP clipped scene captures at phone width are misframed; mobile visual acceptance uses the separate full viewport screenshots, not those crops. There is no corresponding clipping in the actual page.
No source copy, metadata, beta/install state or other subsystem was changed by deployment.

Evidence directory: `/root/octoport-control/design/contour-r4-live/`.
Evidence SHA-256:
- `deploy.log`: `4e767650788695ac9365a79f4833c546f11a2e456c70547b44a87618a5fe3cd5`.
- `http.json`: `12d7c4b6bcc0e0eb4bb72bfab394d20caaa603e2b7ef1001bb11e839099d66b1`.
- `chrome/results.json`: `0ded7a1547e699aa8296f7240e03b8bef0118f80e51d78f4d0bdad18947a6cbe`.
- `opera/results.json`: `d132094feaaa8b6f5fd68acef612bd2683a07ded987a98e2d3a9157709919d5e`.
- `yandex/results.json`: `b8cda2355e5c816d80e59860a4c5562d12e63aa8029e4cc2507343d558b096c5`.
- `visual/chrome-phone-viewport-True.png`: `a0f05b5de40f42f6689501dce8a3f30b288cd5143d33cd6659a1324702365f4a`.
- `visual/chrome-phone-viewport-False.png`: `722d3be18fb6380d7dcd4e142a5472663efc2d2edf96f04826aaf5a534b9f6c5`.
