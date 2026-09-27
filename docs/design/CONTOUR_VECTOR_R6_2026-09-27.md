# Contour R6 — true vector octopus

Status: SOURCE_CANDIDATE / PRODUCTION_PENDING.

Owner request: replace the accepted raster octopus with a real vector while preserving the current Contour composition, eight independent controls and the visual interaction between tentacles and buttons.

R6 uses the already accepted reference-derived alpha source. It does not generate a new mascot and does not embed PNG/WebP data inside SVG. The public scene is now a path-based external SVG asset.

Architecture:
- static octopus, orbit, stars and tentacles: SVG paths below controls;
- WB/Ozon foreground tentacle grips: separate SVG paths above controls;
- six AI controls and two marketplace controls: unchanged independent DOM links;
- no tentacle pixels or SVG paths are children of any button.

## Color and theme

The vector uses `currentColor`; CSS supplies the same `--scene-ink` token used by the independent circle borders and labels:
- light: `#10243c`;
- dark: `#ebffff`.

The foreground grip paper uses `--scene-paper`. This removes the raster/compositing color mismatch that required R5 alpha strengthening.

## Reproducibility

`apps/site/design-sources/build_contour_r6_vector.py` deterministically rebuilds `apps/site/public/assets/contour-vector-r6.svg` from the accepted compressed masks. The SVG contains symbols and path geometry only; it contains no `<image>`, raster data URL, PNG or WebP reference.

Manifest: `apps/site/design-sources/contour-vector-r6.json`.
Asset SHA-256: `9baef26cb7eef9eb3d40a3acfbf7562a725d6798b00a17796887a4448b286295`.

## Source acceptance

The final trace threshold was selected by comparing browser-rendered R6 geometry with the accepted R5 live raster. At the 960 px scene, foreground-mask overlap is about 94.1% and the vector foreground area differs by about 1.3%, substantially closer than the first trace candidate.

- source Contour regression: 15/15 PASS;
- site deployment regression: 13/13 PASS;
- deterministic vector rebuild: identical SHA-256 on repeated rebuild;
- Chrome / Opera / Yandex source browser QA: 102 states PASS;
- independent hover/focus: 48/48 pairs PASS;
- Chrome scene-corner transparency: 16/16 sampled screenshots PASS;
- Chrome results SHA-256: `b27d50f53a7302d60d7bf746cd189806d28363c3ea7febdb4773fffcd230d74b`;
- Opera results SHA-256: `37313b0ee5b1b8ccd2b2d61f92109a59b0754bd1f96e2b3687b917270538cd22`;
- Yandex results SHA-256: `8501d9862a06d33772118110ea4095b8c280fc9303dddb5a314f75de21406b59`.

Production deployment and live acceptance remain separate.
