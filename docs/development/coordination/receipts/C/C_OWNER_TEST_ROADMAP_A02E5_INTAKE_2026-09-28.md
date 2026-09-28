# C — owner-test roadmap + A 02e5e186 intake — 2026-09-28

Status: **INTEGRATED CANDIDATE / LOCAL R1 CHECKS PASS / BRANCH CI NEXT / NO LIVE OWNER ACTION YET**

R0 is complete on canonical `main` exact `8c273711922f8646c22be6279b128d8dd20f8c67`: branch five required workflows and fresh post-main five required workflows all passed. Frozen STORE 0.2.6 bytes remain unchanged: Chromium/Opera SHA-256 `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`; Firefox SHA-256 `b5de9b4f0773c08a705fbad050e77d382f265aa34fd2ca8d3657553bad577305`.

C then integrated the exact controller documentation chain in required order:
- `15ca964e56dba9230f520e67a919d5b1136bb847` — monitoring repair architecture;
- `672b35a98e7bb4037dfc7ec1e4713371b307a506` — owner-test/monitoring roadmap + PLAN priority;
- `ad7b62976c318d01111bc6f9675b495cfa99469f` — exact controller audit.

C integrated exact A candidate `02e5e186221fe9f93c574070721b09c645c7dcfd`. The candidate added R1 receipts and test infrastructure only; no STORE/package product byte changed. The previously suspected WB test conflict was proved format-only before intake: Prettier on A's WB blob produced a byte-identical current blob (SHA-256 `790013a442a3fa4e37f3c3e45043fda732728f426245f8ca45e37e035d01ad5b`). Git therefore merged it without changing the accepted formatted WB file.

C independently reran A's two new critical boundaries. Exact STORE signed-out Opera test on `/usr/bin/opera` 136.0.6008.22 passed via supervised Xvfb: exact ZIP/hash/version, `auth-start` and privacy-safe diagnostics visible, external HTTP(S) 0, page errors 0; live auth was intentionally not started. Supervisor `octoport-test-c-aadeb9e4ab924a77a5da6c13edda4e2f.service` exited 0, OOM 0, cleanup verified.

C also generated an ephemeral test Ed25519 authority, built the current 0.2.6 development composition, and reran `profile-dom-consumer.py`. Result PASS with `disposition=NOT_WIRED`: signed profile revision `1 -> 2`, content hash and composer reference changed, but the real MV3 content-script picker selected the same composer, inserted only the non-sending marker and recorded `sentCount=0`. Supervisor `octoport-test-c-0623fe84a79b4eebb85a9823866f54f0.service` exited 0, OOM 0, cleanup verified; the ephemeral private key/config were removed by the bounded job.

`git diff --check`, Python compile for all changed Python tests and `node tooling/checks/docs-check.mjs` pass on the integrated tree. Exact current C candidate HEAD before branch publication is recorded by Git/control state, not hard-coded here.

R1 remains honest: signed-out exact STORE is accepted, but ordinary signed authentication and the authenticated exact-STORE popup/useful-flow matrix are still open. Firefox exact STORE permission grant/revoke and Windows same-item update remain separate browser/channel gaps and do not block an Opera-first hand-test build.

R2 preparation remains exact backend `62024d192a8572c11aafab91653330d1f996699f`; current reviewer runtime API/bootstrap/compatibility/portal paths are unchanged relative to that accepted backend, while STORE1 tooling alone was rebound to 0.2.6. Local 0.2.6 reviewer inputs/draft are under `/root/octoport-control/logs/C/store1-reviewer-026/`. Owner-test API/worker/portal have not been switched and still run the old owner-test runtime.

Monitoring remains parallel and non-blocking for R0-R3. Controller currently owns/reserves `tooling/api-watch/src/incident.ts` and `incident.test.ts` for the false-recovery repair; C's earlier child patch is retained only as NOT_ACCEPTED evidence and will not compete. B owns retention/schema work. Authenticated H3 stays disabled without the legitimate dedicated technical session.
