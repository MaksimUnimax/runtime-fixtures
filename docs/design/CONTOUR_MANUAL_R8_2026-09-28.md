# Contour Manual R8 — smooth redraw

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

Owner rejected the R6 traced-vector result because it preserved raster edge noise and pixel-shaped contour irregularities. R8 does not trace pixels.

The hero octopus is now authored directly in HTML SVG geometry using hand-defined cubic Bézier paths, ellipses and mirrored groups. There is no raster octopus, no embedded image, no external SVG artwork, and no pixel-derived path mask in the hero scene.

The eight AI/marketplace controls remain independent DOM links. Tentacle artwork is outside the links, so hover/focus can move a control without moving any tentacle artwork.

## Rendering contract

- Light ink: `#10243c`.
- Dark ink: `#ebffff`.
- Both SVG artwork and DOM circles use the same `--scene-ink` token.
- Tentacle bodies use smooth filled Bézier shapes, not stroked raster outlines.
- Engraving-like undersides and suction cups are vector primitives.
- WB/Ozon foreground contact remains a separate, pointer-events-none SVG layer above the controls.

## Verification

Source unit regressions: 15/15 PASS.
Deployment regressions: 13/13 PASS.
Chrome / Opera / Yandex full source QA: 102 states PASS.
Independent hover/focus checks: 48/48 PASS.
Widths cover desktop, tablet and mobile down to 320 px, in light and dark themes.
