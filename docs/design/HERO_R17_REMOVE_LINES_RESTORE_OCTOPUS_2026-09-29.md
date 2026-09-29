# HERO R17 — remove outer lines and restore octopus

Date: 2026-09-29

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

Owner correction to R16:

- remove the top pill `ВАШ ИИ. ВАШИ ПРОДАЖИ.`;
- remove the large decorative orbital/horizon lines and their small outer dots;
- keep the selected R16 heading, body copy, provider colors, separator star, employee sentence, free-account sentence and CTA styling;
- restore the accepted R13 octopus itself below the CTA buttons;
- do not restore the eight brand circles or the old orbit composition.

The restored mascot is the existing `contour-owner-static-r13.svg`, visually cropped by a CSS viewport so only the owner-approved octopus is visible. The asset is not regenerated.

Source acceptance: 36/36 site tests PASS; Chrome 1440/960/390/320 hero states and both CTA hover/focus checks PASS; visual inspection confirms no outer R16 lines/pill and a complete, unclipped octopus.
