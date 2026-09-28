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

## Production acceptance

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

Production release: `bf4751cd790a10ff72137b931acf8b2763824e5f`.
Rollback backup: `/var/backups/octoport-site/20260928T022345Z`.

Live Chrome / Opera / Yandex quick QA: 30 states PASS.
Live independent hover/focus checks: 48/48 PASS.
Live result SHA-256:
- Chrome: `911dbc60b940f1b522f3da0bd615f7e376becdf8f14a2d16ad5bab9d189dd13e`
- Opera: `2fdc7e2620a7d5d88d34afb736633a4263716112d3772258ddd5a03a2fa0a631`
- Yandex: `2daeec05dfb8dad8e704a6983fa2f0ccdfd33295ecc126c5e58d0d72e4bf6467`
