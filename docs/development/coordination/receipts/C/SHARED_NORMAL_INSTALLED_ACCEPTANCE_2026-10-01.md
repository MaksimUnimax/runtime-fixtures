# C05 shared normal installed acceptance — 2026-10-01

Status: **PASS — SOURCE + DISPOSABLE DB/API + INSTALLED_SYNTHETIC; NOT LIVE_OWNER/DEPLOYMENT/PRODUCTION**

Task: `SHARED-NORMAL-INSTALLED-ACCEPTANCE`.
Parent working HEAD before this acceptance change: `bc0a9bf3c7dcd05a7a74c812d75c9c0a2d5f7d6b`.
Changed harness: `tests/regression/extension-core/client-i1/installed_local_integration.py`.
Final harness SHA256: `6d6ef015340c1f112c2d8ae62d85395dd1d341a9047807cd327c4ea2f218efe0`.
Exact harness diff SHA256 against parent HEAD: `9644a812c79aa0762af6c785ebaf2868d9e489ec9923bd96a40f0454eda86e38`.

## Exact installed candidate

Final supervised installed run:
`/root/octoport-control/logs/C/shared-normal-installed-acceptance-r15/result.json`

Resource receipt:
`/root/octoport-control/resource-jobs/12f9287ef1604636aa2629d88e6997ef/receipt.json`

Candidate ZIP:
`/root/octoport-control/logs/C/shared-normal-installed-acceptance-r15/candidate-package/SELLER_AGENTS_I1_C1_v0.2.11_LOCAL_DEVELOPMENT.zip`

ZIP SHA256:
`01aa5a516d06f1fa92161e5ecaa94ed1e866cf091c6b8f5210cfb39f7fc45705`

ZIP bytes: `2278187`.
Package: `0.2.11 / LOCAL DEVELOPMENT`.
Product runtime input SHA256:
`94cf9d4f43f4453a27cf5d0ad8230d564b4744aabb2f3976167a0b7f15388774`.
Observed browser: Chromium `151.0.7922.34`.

The ZIP is an exact **test candidate only**. It uses process-local generated test trust and `BETA_SYNTHETIC_FIXTURE`; it is not a store package and is not READY_FOR_OPERATOR.

## Final installed evidence

R15 ran through `C heavy --db --profile e2e` with:
- command exit `0`;
- supervisor cleanup verified;
- OOM kills `0`;
- exact package hash read back unchanged.

R15 proves at **INSTALLED_SYNTHETIC / LOCAL DEVELOPMENT** level:
- real loopback API and Next portal over C's disposable PostgreSQL;
- ordinary device authorization start, portal OTP/approve, device exchange and signed Bootstrap V2;
- two fixture accounts remain isolated; the previous account's store is not exposed after account reset and second login;
- installed Work Start sends the initial instruction and reaches `active_visible` with a durable start intent;
- the successful Start path independently verifies the observed bootstrap signature with the packaged trust bundle and requires `RESOLVED` ChatGPT scope plus valid signed profile material and compatible browser family/version;
- the support snapshot reports all privacy inclusion flags false and is negatively checked against fixture credentials, account/device/session identifiers, all store IDs, conversation identity, private page marker and the sent prompt;
- full Chromium persistent-profile restart creates a new MV3 worker and preserves the same account, device/session, store IDs, work revision, start intent, conversation/origin and active work state without a new login or new Start.

The result file stores only package hashes, technical states and boolean equality/privacy outcomes. Raw account/store/device/session/conversation identifiers and credentials are not persisted in the acceptance result.

## Fresh auth-lifecycle evidence

C independently reran the existing ordinary-auth lifecycle on real disposable PostgreSQL/API routes:

Log:
`/root/octoport-control/logs/C/shared-normal-installed-auth-lifecycle-r1.log`

Resource receipt:
`/root/octoport-control/resource-jobs/5008437bc58b4a6dbdec9da3ba038c71/receipt.json`

Result: PASS for ordinary OTP login, pending exchange, approval, stable exchange idempotency, cancellation/deny, server expiry closure, active-device revoke and logout. This is DB/API integration evidence, not a browser or LIVE_OWNER claim.

## Independent review history

- R1: `/root/octoport-control/logs/C/shared-normal-installed-review-20261001-result.md` — **REWORK_REQUIRED**: signed profile was not asserted on the success path; restart identity was too weak.
- R2: `/root/octoport-control/logs/C/shared-normal-installed-review-r2-20261001-result.md` — **REWORK_REQUIRED**: those two findings were fixed; privacy negatives did not yet include credentials/store/conversation/page/prompt markers.
- R3: `/root/octoport-control/logs/C/shared-normal-installed-review-r3-20261001-result.md` — **PASS** on the exact R15 harness bytes. Reviewer confirmed the normal activation path, signed profile verification, exact restart identity, privacy negatives and the INSTALLED_SYNTHETIC/LOCAL DEVELOPMENT evidence boundary. No browser/server/DB checks were rerun by the reviewer.

## Retained rework evidence

Earlier failed runs remain historical evidence and are not counted as PASS:
- a STORE package correctly failed loopback transport because its packaged endpoints are preproduction;
- an old local package correctly failed `BOOTSTRAP_UNKNOWN_SIGNING_KEY` because its process-local signing private key was not persisted;
- early Start attempts exposed a test-fixture version mismatch and then missing synthetic beta access basis;
- an early restart assertion incorrectly counted stores from all isolated accounts rather than only the current authority account;
- pre-review R12/R14 PASS runs were superseded by later reviewer findings and do not constitute final acceptance.

No product auth, authenticated/workAllowed state, CSRF, TTL, signing verification, profile compatibility, schema/migration or marketplace safety rule was weakened to obtain R15 PASS.

## Limitations and disposition

- OTP is a generated local development fixture. Real email delivery is **not** tested here.
- Beta eligibility is `BETA_SYNTHETIC_FIXTURE`, not evidence for a real owner/reviewer account.
- ChatGPT is a deterministic installed fixture. No live ChatGPT login, H3, or live model answer is claimed.
- Provider business calls are zero. No live Ozon/WB call or marketplace mutation occurred.
- No live catalog/profile mutation, production DB mutation, deployment, store submission or production publication occurred.
- Real STORE 0.2.11 packages and their existing browser-matrix evidence remain separate immutable release evidence.
- Canonical operator records `OCTOPORT-0_2_11-CHROMIUM-66c8b34e` and `OCTOPORT-0_2_11-FIREFOX-f53340cc` remain `PREPARING`: R15 used different LOCAL DEVELOPMENT bytes and therefore does not promote either STORE package to `READY_FOR_OPERATOR`. Exact STORE/backend/feedback reconciliation remains the separate `C06-NORMAL-INSTALLED-RECONCILIATION` boundary.

This closes the isolated C05 installed/local acceptance slice. It does **not** by itself close C06/C07, prove LIVE_OWNER usefulness, or replace manual semantic acceptance.
