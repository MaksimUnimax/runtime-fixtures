# Contour R5 — exact ink match between illustration and controls

Status: SOURCE_CANDIDATE / PRODUCTION_PENDING.

Owner-reported defect: the octopus/tentacle raster looked visibly duller than the independent CSS circles even though their nominal hue was intended to match.

Cause: the R4 illustration correctly used #10243c (light) and #ebffff (dark), but reference-derived antialiasing encoded much of the line art as partially transparent pixels. Those pixels were composited with the page background, so the perceived stroke became gray-blue / pale instead of the solid control color.

R5 keeps the same geometry, source reference, badge cutouts, static foreground grips, eight independent links, responsive layout and theme behavior. No new image is generated and no button contains tentacle pixels.

## Implementation

The source alpha is deterministically overprinted three times using:

`alpha' = round(255 * (1 - (1 - alpha/255)^3))`.

This increases stroke opacity while preserving antialiased edges. RGB remains the exact shared palette:
- light: `#10243c`;
- dark: `#ebffff`.

The same transformation is applied to the small foreground grip ink masks. New cache-distinct assets use the R5 filenames. R4 assets remain historical and unchanged.

## Source acceptance

- Contour source regression: 15/15 PASS.
- Site deployment regression: 13/13 PASS.
- Chrome / Opera / Yandex source browser QA: 102 states PASS.
- Independent hover/focus: 48/48 pairs PASS; static octopus/grip layers do not move.
- Width coverage retains desktop, tablet and phone breakpoints including 320 px.
- R5 asset hashes are recorded in `apps/site/design-sources/contour-reference-r5.json`.
- Chrome results SHA-256: `f567159a986fc20d24dbe983e051f0dac420636c078aecd70d42aff001cb9d78`.
- Opera results SHA-256: `d6b2aa348d2adea4312dca4a0dcae5e562760f7dfddef2528f74577dfaa41618`.
- Yandex results SHA-256: `c8da327fdd30edc9acb1051b7280303466ac11d8ac3b6c68ad1edb65bcca378f`.

Production deployment and live acceptance remain separate.
