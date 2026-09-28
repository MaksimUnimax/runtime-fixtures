# Contour R12 — exact canonical-reference trace

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

Canonical source: owner reference 1448×1086, SHA-256 `d3ead9dbba9794c57a3ff2b1267b15c36045eadd9922e7d6a8788a071e73c246`.

R12 removes the geometry-changing R11 reconstruction step. The exact cleaned binary mask is traced with OpenCV `CHAIN_APPROX_SIMPLE` only. There is no RDP simplification, no spline smoothing, no invented geometry, and no button cutout.

## Identity

- Exact packed mask SHA-256: `5c3dc4259d3bc47754f8683026922731270ae603c362a9ec2a3ea1fd2e1f2833`.
- SVG SHA-256: `b8fbdfa3dac6b4a8267bde7f57d813d8de7fb6a484e373ca39b30ee84e9bef82`.
- SVG: 734 contours, 21,901 retained contour points.
- Light scene ink: `#052039`; dark: `#ebffff`.
- Eight DOM controls use centers and diameters fitted from the same canonical reference.

## Source acceptance

- Contour unit tests: 15/15 PASS.
- Site deployment regressions: 13/13 PASS.
- Chrome / Opera / Yandex full source browser QA: 102 states PASS.
- Independent hover/focus: 48/48 PASS.
- Chrome result: `984ee29e136ad2bd3960e055a50aaea926d23f34764e55031fd8db6a2a5054e3`.
- Opera result: `ee9d0eec405474803f4844d9dbd1fb5373037d3de1dd2166a51df282af0ecc9d`.
- Yandex result: `c05c5ee28128b21210a9c9cadc7af88372b7fcdc8c5d5ef3fb0f49cfb3711586`.

## Production acceptance

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

Production release: `0bb4cbbf7ce669cd38df4d5428cf87d781b9ab80`.
Rollback backup: `/var/backups/octoport-site/20260928T053643Z`.

Live Chrome / Opera / Yandex quick QA: 30 states PASS.
Live independent hover/focus checks: 48/48 PASS.

Live result SHA-256:
- Chrome: `0360e9f5aa499d3220df3941ad7633601c5b1c296c1bfc216bd4bac54370ef6e`
- Opera: `93e3120904bd5fddea7f69c869b0513ddf7d7581e5cae74bbb9255e2278cd046`
- Yandex: `548828764d03fe95dc3ea1adb1d47c91b34ca28c2b38321748dc66808e44afbf`
- Deploy log: `c378d8a7caa28188521bb798b080bc10edf2b615140db142e057b283911cdd98`
