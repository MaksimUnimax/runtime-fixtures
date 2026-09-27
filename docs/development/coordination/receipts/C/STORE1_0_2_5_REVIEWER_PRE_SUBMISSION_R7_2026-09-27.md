# STORE-1 0.2.5 reviewer / pre-submission R7 — 2026-09-27

Status: **PREPARED / DEPLOYMENT AUTHORIZATION REQUIRED / REVIEWER LIVE PROOF OPEN / NOT SUBMITTED**

This supersedes the 0.2.4 package authority in the older R5/R6 STORE preparation. It does not overwrite historical receipts.

## Exact STORE package

- source: `68f1621376be4d7aeeff44bc76cc326f8cc64954`;
- tree: `8eb20bbc19bbbaaa73ca1a9ba139efa90194ea9a`;
- version: `0.2.5`;
- contract: `control_plane_v2`;
- Opera/Chromium ZIP: `OCTOPORT_v0.2.5_CHROMIUM_STORE.zip`;
- SHA-256: `33cbf1ad9ec4669abe3a65e24cfbaead4c7c3a1fa711261b2d186d107c33aea1`;
- size: 2,217,404 bytes.

B14 binds STORE1 release/signature/admin planning to this exact authority and its focused 47/47 plus disposable PostgreSQL 5/5 checks PASS. The frozen 0.2.4 package remains historical HOLD only.
## Current backend deployment target

Use exact accepted backend source `62024d192a8572c11aafab91653330d1f996699f` for the bounded owner-test/preprod deployment.

Fresh C05 disposable rollback proof:
- candidate: `62024d192a8572c11aafab91653330d1f996699f`;
- tree: `52e55bfcd10ed7a335a16367df4c14bc11316168`;
- rollback floor: `d24838669c54f21dc161dc48a7e71e0e288384c2`;
- candidate source archive SHA-256: `cb612ac424ec34aa10b0cb20231d8a4bb38afbc84b3bff5b336232b2d0cff5fd`;
- lockfile SHA-256: `e947b55bf62341da18963663545d5fe91e243d83560d40e709a3361350ac34e5`;
- portal build SHA-256: `0decebd78c4a8415ec47ea5e58381abd26ad879858f62ac42d6863294bf954be`;
- evidence: `/root/octoport-control/logs/C/c05-three-service-rollback-62024d19-r1/c05-three-service-rollback-evidence.json`;
- evidence SHA-256: `090f89cd980f130e2c33484cd95b8b726fbcf291f940a292ef0248d5123cc4bf`.

Candidate → floor → candidate passed API live/ready, worker ready, portal login/proxy, N2 PRESENT/WITHHELD, signed-v2 bootstrap and metadata-forget preservation. Supervisor exit 0, peak 1,385 MiB, cleanup verified.
The A03/A04 handoff `f4970e9126fb1bb5ba357ff06908a319281c76d8` changes tests/fixtures/receipts only. It has zero deployment-path overlap with `62024d`, so this backend proof is not invalidated by A intake.

## Reviewer evidence already prepared

A03 Firefox 155 exact 0.2.5 installed-synthetic evidence proves real temporary WebExtension popup operation, WB seller_info and Ozon roles one-call/one-delivery/no-replay/Finish, with live provider calls and proxy upstream both zero.

C independently re-ran the merged-tree A04 business coverage: 45/45 PASS, 101 Ozon refs, 133 WB refs, 56 numeric cases. This strengthens test coverage but is not Opera catalogue or live reviewer proof.

The current 0.2.5 Chromium composition is deterministic and source/extracted bytes match. Package composition itself has `installed_acceptance=false`; do not relabel synthetic browser evidence as catalogue installation.
## Ordered live boundary

### 1. Deployment-only operation

This step requires a separate owner authorization. Its scope is only the owner-test API, worker, portal and their owner-test database.

Before any switch, create a fresh protected rollback point while writes are quiesced and prove restore plus forward migration on an isolated database. Proceed only if the existing migration history is an exact canonical prefix.

The deployment target is exact `62024d192a8572c11aafab91653330d1f996699f`. After the switch, require API live/ready, worker readiness and the portal login page. Business Bridge and the monitoring pilot remain outside scope.

If application readiness fails after a successful forward migration, keep the forward schema and use only the tested application floor `d24838669c54f21dc161dc48a7e71e0e288384c2`. If the migration/state check fails before writes reopen, restore the fresh rollback point and previous service configuration. No destructive schema rollback is part of R7.
### 2. Ordinary reviewer authentication and read-only preflight

After deployment succeeds, authenticate the dedicated reviewer only through normal portal/device flows. Do not use SQL/auth bypass or owner marketplace credentials.

Private operator inputs remain protected mode-0600 files. Passwords, OTP values, bearer tokens, cookies and marketplace tokens are never copied into chat or evidence.

Run the existing STORE1 read-only preflight bound to exact 0.2.5. It may use the ordinary reviewer no-AI bootstrap, but it executes zero catalog mutations. Require CLOSED beta, exact active reviewer/account/admission, signed v2 bootstrap, exact package verification, complete catalog pagination and the final configuration-drift fence.

A BLOCKED or CONFLICT result is a terminal stop for this attempt. READY means only that the next catalog action is planned but still unexecuted.
### 3. Catalog activation remains separate

Any catalog activation is a distinct live mutation boundary. Reuse the existing sequential planner: one planned admin action, readback, then re-run the read-only preflight. Preserve expected-version/CAS fences and stop on drift or conflict.

Do not use direct SQL, open beta, rotate signing keys or create a reviewer as a shortcut.

### 4. Exact 0.2.5 Opera reviewer flow

Before first Submit, use Opera's legitimate developer/review installation route for the exact unchanged 0.2.5 archive. This is pre-submission reviewer evidence, not proof of catalogue installation.

Reviewer flow:
1. normal Octoport login;
2. exact signed v2 bootstrap/config compatibility;
3. add one dedicated reviewer/test Wildberries Personal token through the normal popup;
4. open one supported ChatGPT dialogue and select that reviewer store;
5. Start;
6. one bounded read-only seller-information request through the normal command/provider path;
7. exactly one result, no replay or cross-store/dialogue leakage;
8. explicit Finish.
Capture only sanitized evidence: package digest/version, Opera version, extension identity/provenance, expected UI states, result class and Finish state. Do not capture reviewer token, OTP, cookies, authorization headers, raw seller payload or owner sessions.

### 5. Submit

Once that minimum is genuinely proved, the standing early-store policy allows immediate Opera submission without waiting for C04 deep monitoring, every business scenario, Firefox catalogue approval or the full roadmap.

If the publisher dashboard itself requires login/2FA or an unknown mandatory field, request only that concrete owner action. Do not ask again for publisher registration, icon approval or general Submit permission already supplied.

## Current blockers

1. owner-test/preprod deployment of exact `62024d...` is not authorized or executed;
2. ordinary dedicated reviewer authentication on that backend is not proved;
3. exact 0.2.5 live read-only preflight/catalog state is not proved;
4. catalog activation is not authorized or executed;
5. exact 0.2.5 Opera reviewer useful-flow is not live-proved;
6. Opera dashboard Submit has not occurred.

Monitoring C04 and dedicated ChatGPT Health H3 are independent and are not STORE blockers.
