# Contour R9 — reference-faithful smooth spline vector

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

Owner reference is the canonical visual target. R8 was rejected because it invented new tentacle geometry and changed the mascot.

R9 returns to the previously accepted reference-derived silhouette and rebuilds it as smooth vector geometry instead of keeping the noisy polygonal trace.

The source is the accepted `contour-reference-r4-alpha.b64` mask used by the earlier visually correct raster scene. R9 applies closed-contour simplification and Catmull–Rom cubic splines, filters sub-pixel debris, and writes a real SVG path asset.

## Architecture

- Octopus/orbit/star art: static external SVG below controls.
- WB/Ozon contact grips: separate static SVG layer above controls.
- Six AI controls + WB + Ozon: eight independent DOM links.
- No raster image is embedded in the SVG.
- No tentacle art is inside any clickable control.

Light and dark artwork share the exact same `--scene-ink` token as the circle borders: `#10243c` light and `#ebffff` dark.

Compared with the last accepted R5 raster at the same 1232px browser state, foreground area differs by under 0.4% and foreground IoU is about 91.5%; the remaining difference is primarily antialiasing/spline smoothing rather than a redesigned silhouette.

## Source acceptance

- Site contour unit tests: 15/15 PASS.
- Site deployment regression: 13/13 PASS.
- Chrome / Opera / Yandex full source browser QA: 102 states PASS.
- Independent hover/focus checks: 48/48 PASS.
- 320px, tablet and desktop layouts retain the established responsive behavior.
- Builder: `apps/site/design-sources/build_contour_spline_r9.py`.
- Manifest: `apps/site/design-sources/contour-spline-r9.json`.
- SVG SHA-256: `6a9957bf1325e926be85e8a47d22220308f114bc7fbb77915ca4118564328bb4`.

Source browser result SHA-256:
- Chrome: `84772354bb38df4c578b9f71a35b57a31a12419bf85663cd5469f1917b3a2768`
- Opera: `5bffe76b1f0d7627e17be4b0463e85ede1fa94bebf976665a3e25025079211d0`
- Yandex: `71d73ab76c24fce976aa004a270bbd493ba4e0ee723e05b7500b1ccfb5797d73`
