# Contour R10 — exact owner-reference reconstruction

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

Canonical visual source is the owner-provided reference image:
SHA-256 `d3ead9dbba9794c57a3ff2b1267b15c36045eadd9922e7d6a8788a071e73c246`, 1448×1086.

R10 does not reuse the old site R4/R5 silhouette and does not invent new octopus geometry. The vector is reconstructed directly from the canonical reference, with all eight button regions removed from the static art so the existing controls remain independent DOM links.

The resulting SVG contains vector path geometry only; there is no embedded PNG/WebP/image node.

## Geometry

The scene uses the reference's native 4:3 aspect ratio. Button centers and diameters are measured from that same reference rather than inherited from R9.

- Alice: 36.395028%, 13.627993%, diameter 12.154696%.
- Gemini: 63.328729%, 13.627993%, diameter 12.154696%.
- ChatGPT: 19.958564%, 29.005525%, diameter 12.430939%.
- DeepSeek: 79.765193%, 29.005525%, diameter 12.430939%.
- Anthropic: 10.013812%, 49.263352%, diameter 12.430939%.
- Qwen: 89.986188%, 48.987109%, diameter 12.430939%.
- Wildberries: 28.660221%, 81.583794%, diameter 18.922652%.
- Ozon: 70.994475%, 81.952118%, diameter 18.922652%.

There is no foreground tentacle layer attached to a control. The static reference art terminates at the button holes; the DOM discs cover the seam and can move independently on hover/focus.

## Source acceptance

- Site contour tests: 15/15 PASS.
- Site deployment regression: 13/13 PASS.
- Chrome / Opera / Yandex full source browser QA: 102 states PASS.
- Independent hover/focus checks: 48/48 PASS.
- Source result SHA-256:
  - Chrome: `5c508849b63e6dfe3473de6c90e45fb3223adf55f57f629be3bcf2bf80c835e5`
  - Opera: `540ff38e2193c2225d34a079cfda0643dab61422a516cff8d899da4fb61e27eb`
  - Yandex: `ef8f46b3bc90289cb39cfb6c9a0a5de51be9236eabb568e88634604c5a9896d3`
- SVG SHA-256: `52b811c918bb0bc411093af241229885626488c037e858c78e80552c4fafc217`.

## Production acceptance

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

Production release: `d56ea9603eda2c248ffb78c6a2dfaf0f11cec1ad`.
Rollback backup: `/var/backups/octoport-site/20260928T033152Z`.

Live Chrome / Opera / Yandex quick QA: 30 states PASS.
Live independent hover/focus checks: 48/48 PASS.

Live result SHA-256:
- Chrome: `bed75fb94a5687fa0e672d78a3cc50b06cc3ae9153149f705eb12cee9b4afbd0`
- Opera: `1571fe40f9d538f56922881bd69d50c081befdc45a8eb6afea2d8cce754d653c`
- Yandex: `5af118738c0c801a054c48113f0162f5b02388cc82a3f23d81a79fa492cbec52`
