# A03 0.2.12 branded browser smoke reconciliation — 2026-10-03

## Result

PASS at `INSTALLED_SYNTHETIC_EXACT_STORE_SIGNED_OUT`.

This receipt binds the already accepted exact branded Octoport 0.2.12 browser evidence into one A03 successor without repeating browser execution, rebuilding package bytes, or changing operator readiness.

The shared branded source predecessor is strict-valid DONE `1616a88e35766a1d17055216d1348def50989b9f`, publication registration `62beead9c0b23b99830c627b41007a8ac5ca928da5966bcdb7c980dd3130c5bb`.

## Exact Chromium artifact

- Candidate: `OCTOPORT-0_2_12-CHROMIUM-44870cd7`.
- ZIP SHA256: `44870cd7260dd109168680d6aa17252fafef7e894c0d9b48a8ceff90b29265df`.
- Size: `2253835` bytes.
- Manifest: Octoport — Ozon + Wildberries, version `0.2.12`.
- Source task `A03-0212-BRANDED-CHROMIUM-SIGNEDOUT-SMOKE-20261003` is strict-valid DONE.
- Completion receipt SHA256: `063ba0b1862bcaeee6e10b73e2d7ad615dc775623aa9547a5d4ea94962011c57`.
- Combined evidence SHA256: `fadf2fb2b96053f0cbdf9b052dfcde68e017bc0dc9b433e5516b016f01845f28`.
- Independent review SHA256: `735ca85428b85681c510b03ace802bc756b8bd976bf12bf44a69e06d48b3b464`.
- Current operator-card SHA256: `b9f8855fc7943573335ba7eb21bce35571c559b90ceeb9193d759034b68db731`; readiness remains `PREPARING`.

Accepted installed-synthetic signed-out observations on these exact bytes:
- Opera `136.0.6008.22`: exact ZIP development load; `authenticated=false`, `workAllowed=false`, zero external product/provider HTTP(S) requests and zero page errors.
- Google Chrome `147.0.7727.116`: exact ZIP CDP development load; `authenticated=false`, `workAllowed=false`, zero external product/provider HTTP(S) requests and zero page errors.
- Yandex `26.8.1.1111`: exact ZIP CDP development load; support family `yandex_chromium`; `authenticated=false`, `workAllowed=false`, zero external product/provider HTTP(S) requests and zero page errors.

## Exact Firefox artifact

- Candidate: `OCTOPORT-0_2_12-FIREFOX-27e995a3`.
- ZIP SHA256: `27e995a37d3b48f3a93b6ece6e01b68d8d98f1640dc5b34476ad935398c78dd2`.
- Size: `4205109` bytes.
- Manifest: Octoport — Ozon + Wildberries, version `0.2.12`.
- Source task `A03-0212-BRANDED-FIREFOX-SIGNEDOUT-SMOKE-20261003` is strict-valid DONE.
- Completion receipt SHA256: `4bf9c5caad006ff3ceab600fb1160a59c54a1045840fb901d1b2ff53fde48476`.
- Exact evidence SHA256: `7abbb7d49d6282b6455d4390269f051464ee6743b8080b4bb4d746453a2bad1f`.
- Independent review SHA256: `79a49189b9d69b2c0f1e450b474bf05a723f050eb9375a4d2e1daa1f16d9dc8b`.
- Current operator-card SHA256: `d0fa039acc02e55162727edd3edf3a9ffc10a7a21ab64b699cc1957ffde8829e`; readiness remains `PREPARING`.

Accepted installed-synthetic signed-out observation on these exact bytes:
- Firefox `155.0.1`, add-on `octoport@octoport.ru`, temporary add-on installation.
- Optional technical-data permission followed Deny → Allow → Revoke.
- Support snapshot followed `WITHHELD` → `INCLUDED` → `WITHHELD`.
- All accepted snapshots remain `authenticated=false`, `workAllowed=false`, sensitive diagnostic flags false.
- Network boundary was `LOCAL_DENY_PROXY_NO_UPSTREAM`; no forbidden product/provider request was observed.
- Earlier harness attempts remain recorded as harness failures; the third attempt is the accepted PASS.

## Evidence binding

The source predecessor strict-completion receipt is `/root/octoport-control/logs/A/a03-0212-branding-health-authority-successor-20261003/STRICT_COMPLETION.json`, SHA256 `eaeb210af2825cb32f156eafa3c9e417a273fee3dfc26ff1998c6a79b08ecaba`.

Chromium evidence:
- `/root/octoport-control/logs/A/a03-0212-branded-chromium-signedout-smoke-strict-completion-20261003.json`
- `/root/octoport-control/logs/A/a03-0212-branded-chromium-signedout-smoke-combined-20261003.json`
- `/root/octoport-control/logs/A/A03-0212-BRANDED-CHROMIUM-SMOKE-REVIEW-20261003-result.md`

Firefox evidence:
- `/root/octoport-control/logs/C/a03-0212-branded-firefox-signedout-20261003/COMPLETION.json`
- `/root/octoport-control/logs/C/a03-0212-branded-firefox-signedout-20261003/EVIDENCE.json`
- `/root/octoport-control/logs/C/a03-0212-firefox-evidence-review-20261003-result.md`

Readback also re-hashed both ZIP files and re-read their manifests before this receipt was authored. No browser was launched by this reconciliation.

## Historical blocker disposition

This result is a same-plan successor for the evidence boundary previously attempted by `A03-SUCCESSOR-0212-REAL-BROWSER-SMOKE-20261002`.

The historical row must remain `BLOCKED`; its old package identities and platform-denial history are not rewritten. After this reconciliation itself becomes strict DONE, role A may use the normal trusted `queue-resolve-blocker` mechanism to bind that historical blocker to this exact successor and its completion receipt.

## Explicit non-claims

This receipt does **not** establish:
- ordinary authenticated Work;
- live signed-profile/catalog compatibility;
- minimum-version policy or approved minimum supported browser versions;
- Chrome Web Store, Opera Add-ons, Yandex Add-ons or AMO installation/update;
- `READY_FOR_OPERATOR`;
- LIVE_OWNER marketplace or AI-provider behavior;
- store submission, DEPLOYMENT or PRODUCTION.

Both branded operator candidates remain `PREPARING`.
