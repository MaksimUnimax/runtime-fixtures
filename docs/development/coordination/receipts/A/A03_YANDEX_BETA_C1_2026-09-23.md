# A03 — Yandex Browser Beta real-vendor C1 matrix — 2026-09-23

Status: **REAL YANDEX BETA INSTALLED-SYNTHETIC C1 PASS / STORE RELEASE OPEN**
Role: `A`
Source HEAD under test: `0755f7c75db7f78e0c6d8ae9591665f63e61ee59`.

This receipt closes the previously unavailable automated-development route for the bounded BR-C1 matrix by using a real Yandex Browser Beta binary. It does not claim public-store installation, owner credentials, LIVE_OWNER, deployment, or production acceptance.

## Browser and package identity

- Local isolated vendor package: `yandex-browser-beta`.
- Debian package version: `26.8.1.1101-1`, amd64.
- Binary reports: `Yandex 26.8.1.1101 beta`.
- DEB SHA-256: `a54c3a603785e86cf487643566521987c1df49827d7296795eb6f2912a365cb2`.
- Executable: `/root/octoport-control/browsers/A/yandex-beta-26.8.1.1101-1/unpack/opt/yandex/browser-beta/yandex-browser-beta`.
- The package was unpacked into A's isolated browser cache; no system browser package was replaced.
- The binary emits an FFmpeg lookup warning and falls back to its integrated library when queried for version. This did not block the extension matrix.

The extension runtime itself identified the browser family only as `yandex_chromium`. Its browser-reported compatibility version in the C1 evidence is `26.8.0.0`; this runtime-reported value is retained separately from the Debian package version and is not rewritten by the test.
## Candidate boundary

The C1 run used source and extracted common runtimes built from exact A HEAD `0755f7c...` with a dedicated synthetic local-development trust key/config for the fixture control plane.

This is INSTALLED_SYNTHETIC evidence:
- synthetic account/device/session identities;
- synthetic control/health authority;
- no real marketplace credentials;
- no live provider requests;
- no owner session.

Evidence root:
`/root/octoport-control/logs/A/A03_YANDEX_BETA_C1_0755f7c_R1/`

## Result

Independent aggregation of the retained per-shard `summary.json` files proves:

- source runtime: BR-C1-01..38 = **38/38 PASS**;
- extracted runtime: BR-C1-01..38 = **38/38 PASS**;
- missing scenario IDs: 0;
- non-PASS scenario IDs: 0;
- observed runtime browser family set: exactly `yandex_chromium`;
- provider requests: 0 for source and 0 for extracted.

The first long sequence had failures in shards 05..32. The same unchanged scenarios were rerun in bounded clean-profile shards, after which every previously failing shard passed. Existing green shards 01..04 and 33..38 were retained rather than needlessly repeated.

Rerun aggregate:
`/root/octoport-control/logs/A/A03_YANDEX_BETA_C1_0755f7c_R1/rerun-summary.tsv`

Resource receipt:
`/root/octoport-control/resource-jobs/5e62532d4d5d455fb692466d60bbf883/receipt.json`
Resource result:
- exit code: 0;
- observed peak: 610271232 bytes;
- OOM kills: 0;
- cleanup_verified: true.

## Disposition

This replaces the earlier Yandex stable automated-unpacked-install environment gate only for the bounded development-browser C1 evidence: Yandex Beta provided a legitimate vendor development route and the extension ran as `yandex_chromium`.

Still open:
- ordinary end-user/store installation path;
- STORE-2/STORE-3 signed/distributed install and N→N+1 update;
- owner-profile import/LIVE_OWNER;
- release acceptance outside BR-C1.

No evidence from Opera, Chrome, Chromium, or Firefox is transferred to Yandex. No external store publication was performed.
