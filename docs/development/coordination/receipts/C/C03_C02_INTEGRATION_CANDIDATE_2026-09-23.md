# C03/C02 integration candidate receipt — 2026-09-23

Role: C
Candidate branch: `work/c-integration`
Base main: `de45ce6c6b9dc99c79c4140e28043e17f10fdda5`

Evidence boundaries:
- C03 API-watch: SOURCE.
- A01 extension fix: SOURCE + PACKAGE + INSTALLED_SYNTHETIC only.
- A03 Firefox package gate: SOURCE + PACKAGE + exact real-vendor temporary-install evidence from A; full Firefox functional matrix and other deferred browser-family gates remain OPEN.
- B03 relay, B01 lineage guard and B04 auth/sync hardening: SOURCE / disposable-test evidence only.
- B04 read-only SMTP/network observations do not constitute mailbox OTP acceptance.
- METHOD candidate: documentation/process evidence only.
- LIVE_OWNER, DEPLOYMENT and PRODUCTION: NOT CLAIMED.

## Exact integrated revisions

- C03 implementation: `a062c0f6b76393b53f9c51c7ce29653f77e91398`.
- Controller WORK_METHOD candidate: `285bf66af135e76c7684214d734882740e9a68db`, exact merge receipt ancestor of the integration head.
- B03 submitted candidate: `615dd763ef115ba41a7a24661db8ea374e2d25a4`.
  - Includes B01 submitted candidate `f439c23218e597a23add1e04ce79b44b5238d530` as an ancestor; B01 was not merged twice.
- A01 submitted candidate: `5f2c8d97b9c68930f1b38b229c7efb7e9adca6b8`.
- A03 submitted candidate: `c7301c15d837784bd5d0b966eb8089b9102b38f4`; includes A01 as an ancestor.
- B04 submitted candidate: `dcf9800bc5a2e6c090a1768dfa3062ebd16ce557`; includes B03/B01 as ancestors.
- Current integration head before this receipt update: `9fb5091b41fb190d7300c27fe45a6b0caccb1310`.

## C03 API-watch behavior

C03 extends operation inventory and semantic diff beyond endpoint counts/coarse metadata:

- canonical bounded fingerprints cover parameter, request, response and security semantics;
- required lists and enums are canonicalized where ordering is non-semantic;
- local JSON-pointer refs are resolved cycle-safely; unresolved/recursive refs remain explicit markers rather than fabricated equivalence;
- parameter/request/response schema changes become deterministic diff fields;
- security requirements and used security-scheme definitions are fingerprinted;
- older persisted inventories without the new fingerprints are rebuilt from immutable accepted snapshots before comparison;
- response-level local refs participate in response-schema fingerprints;
- schema descriptions/examples and object-key / enum / required ordering do not create false semantic drift;
- impact classification is conservative: security requirement changes are BLOCKING_RISK; parameter/request/response schema changes are REVIEW_REQUIRED; unknown deltas remain UNKNOWN;
- no READ_POLICY auto-enable/auto-patch path is introduced.

Acquisition now uses one AbortController/deadline across redirects, headers and complete body consumption. A body stalled after headers and a redirect chain that exceeds the total deadline both fail as SOURCE_TEMPORARILY_UNAVAILABLE. Reader cancellation/release and timer cleanup remain bounded.

The existing report surface continues to preserve source family, exact snapshot/base SHA identity, blocker/error fields and unknown counts; no DB/report migration was introduced solely to rename these fields.

## Integrated verification

Toolchain: Node `24.20.0`, pnpm `10.34.5`.

C03/B03 focused:
- combined focused Vitest after integration: 6 files / 156 tests PASS;
- C03-only targeted set before A/B intake: 4 files / 135 tests PASS;
- api-watch acceptance fixture: 4/4 PASS;
- api-watch typecheck: PASS;
- credential-transfer typecheck: PASS;
- API typecheck and `openapi:check`: PASS;
- focused ESLint / Prettier / `git diff --check`: PASS.

B01 migration-lineage on C disposable PostgreSQL:
- @product/db unit: 29/29 PASS;
- typecheck: PASS;
- `canonical-lineage.integration.test.ts`: 6/6 PASS via `control.py C heavy --db`;
- no live DB or migration mutation performed.

A01 fresh integration package from `61230f2...`:
- local-development ZIP: `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`;
- SHA-256: `a91c3a478136f2f32aef57ec7c0e989e58331d869ce17a78ed3b80f0654639a1`;
- repeat archive match: true;
- source/extracted byte identity: true;
- deterministic admission/rebind/pre-token matrix: source PASS;
- independent extracted rerun: exit 0, full PASS;
- this is synthetic/local package evidence, not browser-release or live acceptance.

A03 Firefox candidate:
- exact submitted revision `c7301c15...` was reviewed before merge;
- permanent Firefox package contract PASS;
- A evidence identifies deterministic carrier SHA-256 `5d81918c08599b7810731fa7d240e7a071acdfb210fdb289c270891164f47919` and real Firefox 155.0.1 temporary-install proof for those exact bytes;
- required Firefox data collection declaration is exactly `authenticationInfo` + `personallyIdentifyingInfo`;
- Chromium-oriented C local rebuild uses a different synthetic trust key and therefore a different ZIP SHA; that local rebuild was not misrepresented as the already installed carrier;
- full Firefox functional matrix, Chrome/Yandex installed routes, Safari/macOS and public publication remain OPEN.

B04 merged-tree verification:
- source package unit gate totals 129/129 PASS across email, worker, auth, device-auth, extension-auth, bootstrap and sync;
- API package: 22 files / 249 tests PASS;
- disposable PostgreSQL: auth 14/14, token-core 12/12, device management 7/7, bootstrap 9/9, sync 7/7 = 49/49 PASS;
- auth/worker/API/DB/sync typechecks PASS;
- API `openapi:check` PASS;
- focused ESLint, Prettier and `git diff --check` PASS;
- no live mailbox OTP acceptance or live DB mutation was performed by C.

## Remaining boundaries

- PLAN joint acceptance A02+B03 is still open. Integrating B03 does not by itself prove end-to-end transfer protocol behavior.
- A03 full browser-family release evidence remains open; A01 does not close it.
- B02 shared-contract mismatch remains under controller review: the installed control-plane-v2 client and profile-compatibility-v1 authority cannot be relabeled by B independently.
- Existing controller notices remain controller-owned. C does not close or mark them reviewed.
- The integration head must be published to `work/c-integration` and receive all five required GitHub workflow successes on the exact final HEAD before `ready-main` and main publication.
