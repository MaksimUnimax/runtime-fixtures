# Contour R11 — full canonical reference vector

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

Canonical source is the owner's 1448×1086 reference, SHA-256 `d3ead9dbba9794c57a3ff2b1267b15c36045eadd9922e7d6a8788a071e73c246`.

R11 fixes the R10 mismatch at the button/tentacle junctions. R10 removed circular regions from the static art before vectorization. R11 keeps the full canonical reference geometry, including all eight original circle outlines and every tentacle-to-circle junction.

The interactive architecture is unchanged:
- the complete reference drawing is one static SVG underlay;
- six AI and two marketplace circles remain independent DOM links above it;
- each DOM circle has an opaque theme-paper fill, so it covers the original blank circle underneath without deleting the surrounding tentacle art;
- hover/focus moves only the DOM control; the reference art remains stationary.

No foreground grip/tentacle layer belongs to a control.

## Source identity and generation

- Packed canonical mask SHA-256: `0ae0daac07ecce159ee385bda713f185dc7d53532ad401360fa4dba910c77445`.
- SVG SHA-256: `9ddd493540c55f3eadbc6e08bd2b3107be2acf1dde46d8b8664bd0a6dfe2d1f5`.
- SVG contains path geometry only and no embedded raster image.
- The source mask is stored as `apps/site/design-sources/contour-full-ref-r11-mask.b64`.
- The deterministic builder is `apps/site/design-sources/build_contour_full_ref_r11.py`.

## Source acceptance

- Contour unit tests: 15/15 PASS.
- Site deployment regressions: 13/13 PASS.
- Chrome / Opera / Yandex full source browser QA: 102 states PASS.
- Independent hover/focus checks: 48/48 PASS.
- Chrome result SHA-256: `a987c83925de0bd10f0defa24ee175a2ea97a5881ae6461ec889191cb2fd7d02`.
- Opera result SHA-256: `68a767f688ca379a081ce706105b3eef9b3ddb0ea804502e322f21f8d0c72607`.
- Yandex result SHA-256: `cb4018a2adda1dc85323b54f922e75ebd986fc3b21d069b067f943aeaa3b9891`.

## Production acceptance

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

Production release: `249a6ed2638fcdfa16460cb19025faf60139948d`.
Rollback backup: `/var/backups/octoport-site/20260928T042741Z`.

Live Chrome / Opera / Yandex quick QA: 30 states PASS.
Live independent hover/focus checks: 48/48 PASS.

Live result SHA-256:
- Chrome: `a60849d05ca933bc2a687325ea1d171c916c6c7354049a4e6b4cd9e54b302b88`
- Opera: `aac05b844398653f5d1b3f0be04e2e6a03ed049d800b368723ea8e808d646339`
- Yandex: `6b6e10f979f2ce6fa0b9b49e7faa7e5c35bb741204cc57d86c0b1901f168977e`
- Deploy log: `78bb06707c605b82df57b5616bcebc9b6d6c2ff804047bf06f4d43a2b90fd6ac`
