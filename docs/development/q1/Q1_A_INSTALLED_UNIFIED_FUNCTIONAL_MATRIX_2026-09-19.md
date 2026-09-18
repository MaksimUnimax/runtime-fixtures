# Q1-A Installed Unified Functional Matrix — 2026-09-19

Work ID: `Q1-A-20260919-INSTALLED-UNIFIED-FUNCTIONAL-MATRIX-AND-CURRENT-PACKAGE-REPLAY`

Recommendation: `Q1A_PARTIAL_ENVIRONMENT_DEFERRED`

This is an evidence receipt for architect review. It is not Q1-A self-acceptance.
Q1-B, Q1-C, Q1-D, and Q1-E were not started.

## Git and remote identity

- Start HEAD: `79893dd1f9f9e54dd9959b8ffdef83f7cf4fc0dd`.
- Start tree: `e4873743e0483239131df0cb47edfa4795b54bae`.
- Start branch: `feature/d3s2-full-coordination-closure-2026-09-18`.
- Bounded branch: `feature/q1-a-installed-unified-matrix-2026-09-19`.
- The bounded branch is based directly on the architect-accepted start.
- Final HEAD/tree are recorded in the terminal report after the evidence commit;
  the evidence commit itself is documentation-only.
- Live `git ls-remote` facts:
  - `origin/main` = `bc718cc5c677ad0eb4598e7de3ad766473ff0847`.
  - `origin/integration/i1-c1-srv5-2026-09-16` = `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
  - `origin/docs/roadmap-autonomy-correction-2026-09-18` = `6a48af8cd19137aaa10688c36cb064d3c4b16969`.
- No push was attempted. Status remains `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`;
  no remote verification or publication is claimed.

The worktree contained pre-existing untracked package symlinks and `repro/`
content. They were not deleted, staged, or modified. No Stream-2 implementation
path was changed.

## Environment and package identity

Initial disk state was `/dev/vda1`, 59G total, 57G used, 0 bytes available,
100% full. Safe cleanup removed only exact task-generated disposable paths:
stale `/tmp/seller-agents-c1-chromium-*` profiles, Node 24 tarballs and unpacked
cache, `/tmp/codex-node24-d3s2`, `/tmp/node-compile-cache`,
`/tmp/playwright-transform-cache-0`, and `/tmp/tsx-0`. Repository history,
owner data, Stream-2 data, evidence trees, Docker volumes, and untracked
repository repro content were not removed. After cleanup, available space was
approximately 857MB; it was approximately 553MB after the replay artifacts.

Runtime environment:

- Node: `/root/.nvm/versions/node/v24.20.0/bin/node`, v24.20.0.
- Python: 3.11.0rc1.
- System Chrome: Google Chrome 147.0.7727.116.
- Playwright Python was available. Its canonical managed-Chromium route was
  not used to claim this Q1-A package acceptance; the package was tested through
  source/extracted current-tree gates and the available system-Chrome route.
- Synthetic API/portal fixture and a task-owned PostgreSQL fixture were reached
  by the installed-local harness. The MV3 service worker did not register, so
  that run stopped before popup/auth/provider execution and recorded zero
  control responses.

The recorded configured package was not present anywhere under `/root`:

- Recorded identity from the D3S2/A24 receipt: 39 runtime files, 39 extracted
  files, 2,076,761 bytes, SHA-256
  `0166cd246f5b37229caa1f33f284db5c4530892498882c0659e3e6759fcfedc`.
- It was not silently substituted with a same-named archive.
- A deterministic fixture-neutral package was rebuilt from the exact current
  accepted product sources: 39 runtime files, 39 extracted files, 39 ZIP
  entries, 2,075,976 bytes, SHA-256
  `5f023926ce9fb140766b25fdb4dbe104ce5861f4996d2d3f01b5817aeca64b9c`.
- Repeat build SHA and byte comparison: PASS, identical to the first build.
- Builder source/generated/extracted per-file hashes: PASS.
- The source tree has no product diff from the accepted start in
  `apps/extension`, `packages/bridge-core`, `packages/control-client`,
  `packages/marketplaces`, `migration/reference`, or `tooling/build`.
- Rebuild required: YES for a testable current candidate, because the recorded
  archive itself was unavailable; no production source change caused the new
  candidate.

The exact current candidate used for all direct source/extracted replay below is
the rebuilt `5f0239…64b9c` package. The recorded `0166cd…fedc6` archive remains
an artifact-availability gap, not a claim that the two byte streams are equal.

## Initial failure batch

The complete reachable first batch contained no functional product defect:

1. The first package-builder invocation used a pre-created `mktemp` directory;
   the builder requires a non-existing output directory. This was a harness
   invocation error. A clean invocation passed.
2. I1 checker gate AUT-47 failed on both source and extracted current runtimes:
   `native MV3 registration remains externally deferred after bounded browser
   attempt`.
3. The direct browser verifier and installed-local API/portal harness reproduced
   the same service-worker registration timeout under system Chrome 147. The
   installed-local run reached the synthetic database/API setup and stopped at
   `browser_start`, with zero control responses and zero provider calls.
4. The fresh current-package A22/A23 transfer replay was not safely provisioned
   after disk recovery. This remains
   `ENVIRONMENT_DEFERRED-Q1A-CURRENT-PACKAGE-TRANSFER-REPLAY`; the exact Git
   diff proves no transfer production code changed from the accepted start.
5. The recorded configured `0166cd…fedc6` archive was unavailable; the
   fixture-neutral deterministic current candidate was used and is separately
   identified above.

Root-cause grouping: (1) invocation contract; (2–3) environment/native MV3
registration; (4) environment capacity and missing fresh transfer fixture;
(5) missing artifact. No assertion failure exposed a current product defect,
and no production fix was made.

## Q1A-01 through Q1A-91

Status vocabulary:

- `PASS-LP`: passes in the current exact rebuilt source/extracted runtime or an
  accepted lower-layer current-package replay; not a claim of native system-
  Chrome installed proof.
- `DEFER-MV3`: current-package installed proof was blocked before the extension
  worker registered.
- `DEFER-TRANSFER`: current-package transfer replay was not provisioned; prior
  accepted A22/A23 evidence is preserved because transfer production code is
  unchanged.
- `NOT-REACHED`: the required installed product boundary was not reached.

| ID | Status | Evidence and boundary |
|---|---|---|
| Q1A-01 | DEFER-MV3 | Popup marketplace switch not reached; current source/package behavioral gates remain green. |
| Q1A-02 | DEFER-MV3 | Multiple Ozon popup stores not reached in this package; prior D3S2 store matrix preserved. |
| Q1A-03 | DEFER-MV3 | Multiple WB popup stores not reached; prior adapter/store evidence preserved. |
| Q1A-04 | PASS-LP / DEFER-MV3 | Ozon Seller-only shape passes accepted A24/current helper evidence; native popup route deferred. |
| Q1A-05 | PASS-LP / DEFER-MV3 | Ozon Seller+Performance shape passes accepted A24/current helper evidence; native popup route deferred. |
| Q1A-06 | PASS-LP / DEFER-MV3 | Rename/revision fencing passes D3S2/C3E current-package gates; popup route deferred. |
| Q1A-07 | PASS-LP / DEFER-MV3 | Delete/tombstone fencing passes D3S2/C3H gates; popup route deferred. |
| Q1A-08 | PASS-LP / DEFER-MV3 | New Start passes C3H AUT-02/13; installed fixture route deferred. |
| Q1A-09 | PASS-LP / DEFER-MV3 | Historical Start and inert old content pass C3H AUT-03/29. |
| Q1A-10 | PASS-LP / DEFER-MV3 | Resume passes C3H AUT-04. |
| Q1A-11 | PASS-LP / DEFER-MV3 | Store-change warning/rebind and callback fencing pass C3H AUT-05/26/35. |
| Q1A-12 | PASS-LP / DEFER-MV3 | Marketplace-change context fencing passes C3H AUT-06/10. |
| Q1A-13 | PASS-LP / DEFER-MV3 | Finish before/during/after work passes C3F/P2/C3H AUT-28/34. |
| Q1A-14 | PASS-LP / DEFER-MV3 | Visibility semantics remain covered by application/lifecycle gates; native popup route deferred. |
| Q1A-15 | PASS-LP / DEFER-MV3 | Sequential batch and per-command fencing pass core/I1/C3G gates. |
| Q1A-16 | PASS-LP / DEFER-MV3 | HELP/API ordering is covered by command registry/application gates. |
| Q1A-17 | PASS-LP / DEFER-MV3 | Invalid schema fails closed in core/application gates; provider traffic is zero. |
| Q1A-18 | PASS-LP / DEFER-MV3 | Unknown operation/host fails closed in core/provider gates. |
| Q1A-19 | PASS-LP / DEFER-MV3 | Mutation attempt remains read-only and fails closed in provider safety gates. |
| Q1A-20 | PASS-LP / DEFER-MV3 | Known report START passes C3H AUT-14/P1 report gates. |
| Q1A-21 | PASS-LP / DEFER-MV3 | STATUS not-ready is returned honestly without hidden polling. |
| Q1A-22 | PASS-LP / DEFER-MV3 | STATUS ready handling passes report lifecycle gates. |
| Q1A-23 | PASS-LP / DEFER-MV3 | DOWNLOAD/file materialization passes C3H/P2/core attachment gates. |
| Q1A-24 | PASS-LP / DEFER-MV3 | Unknown START is not repeated; P1 UNKNOWN is terminal for replay. |
| Q1A-25 | PASS-LP / DEFER-MV3 | Restart recovery preserves known local state without marketplace repeat. |
| Q1A-26 | PASS-LP / DEFER-MV3 | Bounded result/file paths pass current P2/attachment evidence; large-JSON popup proof deferred. |
| Q1A-27 | PASS-LP / DEFER-MV3 | Binary/XLSX byte path passes current attachment and A24 helper gates. |
| Q1A-28 | PASS-LP / DEFER-MV3 | Original provider-file integrity path passes current file-delivery gates. |
| Q1A-29 | PASS-LP / DEFER-MV3 | Local technical buffer is bounded in P2/P3 gates. |
| Q1A-30 | PASS-LP / DEFER-MV3 | Buffer expiry is replay-forbidden in P2/P3 gates. |
| Q1A-31 | PASS-LP / DEFER-MV3 | Transaction abort produces no false success in core durability gates. |
| Q1A-32 | PASS-LP / DEFER-MV3 | Worker reconstruction passes C3H AUT-11. |
| Q1A-33 | PASS-LP / DEFER-MV3 | Persistent restart passes C3H AUT-12 and P2/P3 gates. |
| Q1A-34 | PASS-LP / DEFER-MV3 | Duplicate UI/action single-flight passes race/application gates. |
| Q1A-35 | PASS-LP / DEFER-MV3 | Provider UNKNOWN has no automatic replay (C3H AUT-49/P1). |
| Q1A-36 | PASS-LP / DEFER-MV3 | Delivery UNKNOWN has no automatic resend (P2). |
| Q1A-37 | PASS-LP / DEFER-MV3 | Confirmed delivery has no duplicate Send (P2/P3). |
| Q1A-38 | NOT-REACHED / DEFER-MV3 | Synthetic two-account installed isolation stopped before worker registration. |
| Q1A-39 | NOT-REACHED / DEFER-MV3 | Synthetic local logout fence not reached in current installed run; C3H local reset lower-layer pass. |
| Q1A-40 | NOT-REACHED / DEFER-MV3 | Synthetic free-beta popup flow not reached; server fixture setup was reachable. |
| Q1A-41 | NOT-REACHED / DEFER-MV3 | Last-slot installed race not reached; accepted server capacity tests remain separate. |
| Q1A-42 | NOT-REACHED / DEFER-MV3 | Capacity-reached installed flow not reached. |
| Q1A-43 | NOT-REACHED / DEFER-MV3 | Synthetic admin-authorized beta increment not run; Q1-D UI/RBAC excluded. |
| Q1A-44 | PASS-LP / DEFER-MV3 | Same-store dialogue isolation passes C3H AUT-08. |
| Q1A-45 | PASS-LP / DEFER-MV3 | Different-store isolation passes C3H AUT-07/48 and D3S2 gates. |
| Q1A-46 | PASS-LP / DEFER-MV3 | Ozon/WB parallel adapter separation passes C3H AUT-10 and WB/core gates. |
| Q1A-47 | DEFER-MV3 | Multiple tabs same-dialogue native installed proof blocked at worker registration. |
| Q1A-48 | PASS-LP / DEFER-MV3 | Two-installation partition semantics pass C3H AUT-09; native installed route deferred. |
| Q1A-49 | PASS-LP / DEFER-MV3 | Offline new Start and signed grace pass C3H AUT-02/17/18. |
| Q1A-50 | PASS-LP / DEFER-MV3 | Offline Resume passes C3H AUT-04. |
| Q1A-51 | PASS-LP / DEFER-MV3 | Offline store change passes C3H AUT-05. |
| Q1A-52 | PASS-LP / DEFER-MV3 | Offline marketplace change passes C3H AUT-06. |
| Q1A-53 | PASS-LP / DEFER-MV3 | Offline local-first metadata change passes C3H/D3S2 gates. |
| Q1A-54 | PASS-LP / DEFER-MV3 | Recovery convergence without blocking Work passes C3H AUT-30. |
| Q1A-55 | PASS-LP / DEFER-MV3 | Disconnected installation remains UNKNOWN, C3H AUT-39. |
| Q1A-56 | PASS-LP / DEFER-MV3 | Duplicate requestId idempotency passes C3H AUT-31. |
| Q1A-57 | PASS-LP / DEFER-MV3 | Stale baseRevision conflict is deterministic in C3E/sync gates. |
| Q1A-58 | PASS-LP / DEFER-MV3 | Late ACK cannot undo newer binding, C3H AUT-33/C3F. |
| Q1A-59 | PASS-LP / DEFER-MV3 | Late delivery after Finish is fenced, C3H AUT-34. |
| Q1A-60 | PASS-LP / DEFER-MV3 | Late delivery after store switch is fenced, C3H AUT-35. |
| Q1A-61 | PASS-LP / DEFER-MV3 | Clock skew cannot change authority, C3H AUT-38. |
| Q1A-62 | PASS-LP / DEFER-MV3 | Preferred executor stability passes C3H AUT-37/C3F. |
| Q1A-63 | PASS-LP / DEFER-MV3 | Local quota coordination passes P1/P3 current-package gates. |
| Q1A-64 | PASS-LP / DEFER-MV3 | Known 429/Retry-After is a bounded tail wait without hidden retry. |
| Q1A-65 | PASS-LP / DEFER-MV3 | Authority recheck before retry passes C3G/P1/P3. |
| Q1A-66 | PASS-LP / DEFER-MV3 | Independent second-installation quota possibility is preserved by design. |
| Q1A-67 | DEFER-TRANSFER | Current-package A22 happy-path rerun not provisioned; accepted A22 installed evidence preserved. |
| Q1A-68 | DEFER-TRANSFER | Current-package Ozon Seller+Performance transfer rerun not provisioned; no transfer diff. |
| Q1A-69 | DEFER-TRANSFER | Current-package WB transfer rerun not provisioned; no transfer diff. |
| Q1A-70 | DEFER-TRANSFER | Source-offline/later-discovery current replay not provisioned; accepted lower-layer evidence preserved. |
| Q1A-71 | DEFER-TRANSFER | Tamper/replay current-package smoke not provisioned; no transfer production diff. |
| Q1A-72 | DEFER-TRANSFER | Account/device isolation current-package smoke not provisioned; no transfer production diff. |
| Q1A-73 | DEFER-TRANSFER | Ephemeral relay durable-storage audit not rerun; accepted A22/A23 not revoked. |
| Q1A-74 | PASS-LP / DEFER-MV3 | A24 multi-store encrypted export passes exact current source/extracted helper route; native UI route deferred. |
| Q1A-75 | PASS-LP / DEFER-MV3 | Same-account clean-profile import passes A24 current helper route. |
| Q1A-76 | PASS-LP / DEFER-MV3 | Wrong password/tamper pass A24 current helper route. |
| Q1A-77 | PASS-LP / DEFER-MV3 | Account mismatch passes A24 current helper route. |
| Q1A-78 | PASS-LP / DEFER-MV3 | Conflict/tombstone passes A24 current helper route. |
| Q1A-79 | PASS-LP / DEFER-MV3 | Server unavailable local-file behavior passes A24 helper route. |
| Q1A-80 | PASS-LP / DEFER-MV3 | Import starts with zero Work/provider/AI side effects in A24 helper route. |
| Q1A-81 | PASS-LP / DEFER-MV3 | FRESH authority passes C3H AUT-17. |
| Q1A-82 | PASS-LP / DEFER-MV3 | STALE_BUT_OFFLINE_GRACE_ELIGIBLE passes C3H AUT-18. |
| Q1A-83 | PASS-LP / DEFER-MV3 | Exact grace boundary denies, C3H AUT-19. |
| Q1A-84 | PASS-LP / DEFER-MV3 | CACHE_EXPIRED denies, C3H AUT-20. |
| Q1A-85 | PASS-LP / DEFER-MV3 | Tampered authority denies in signed metadata/verifier gates. |
| Q1A-86 | PASS-LP / DEFER-MV3 | Known revocation denies, C3H AUT-23. |
| Q1A-87 | PASS-LP / DEFER-MV3 | Account mismatch denies, C3H AUT-24. |
| Q1A-88 | PASS-LP / DEFER-MV3 | Device/session mismatch denies, C3H AUT-25. |
| Q1A-89 | PASS-LP / DEFER-MV3 | Credential revision mismatch fences, C3H AUT-26. |
| Q1A-90 | PASS-LP / DEFER-MV3 | Deleted store fences, C3H AUT-27. |
| Q1A-91 | PASS-LP / DEFER-MV3 | Health freshness remains separate from autonomous grace, C3H AUT-45. |

The two current direct replays were source and ZIP-extracted runtimes from the
`5f0239…64b9c` candidate. `tooling/checks/extension_core.py` passed 111/111
processes. The I1 checker reached 67 processes before AUT-47; the independent
continuation ran the full listed source/extracted matrix, with only C3H AUT-47
failing on native MV3 registration. No Q1-A product harness currently exists
for all 91 rows, so rows marked installed-deferred are not promoted from
lower-layer evidence to installed PASS.

## Regression and safety receipts

No production code changed, so the full server/PostgreSQL/E2E release matrix
was not needlessly rerun. The relevant accepted layers were replayed against
the current source/extracted candidate:

| Layer | Result |
|---|---|
| D3S2 store/state | Accepted bounded evidence preserved; no source diff. |
| A22/A23 | Accepted bounded evidence preserved; current-package replay deferred. |
| A24 | Current source/extracted focused helper PASS; installed native route deferred. |
| C3E | Current direct source/extracted gates PASS. |
| C3F | Current direct source/extracted gates PASS. |
| C3G | Current direct source/extracted gates PASS. |
| C3H | AUT-01..46 and AUT-48..50 PASS; AUT-47 native MV3 environment defer. |
| P1 | Current provider-outcome/no-replay gates PASS. |
| P2 | Current result/delivery recovery gates PASS. |
| P3 | Current scheduler gates PASS; lower-layer 100-wake receipt preserved. |
| Extension Core | 111/111 PASS. |
| Extension I1 | Fail-fast at native MV3 AUT-47; independent continuation otherwise green. |
| Application | Current direct application gate PASS. |
| API/integration/E2E | Existing accepted evidence retained; installed-local harness stopped before browser worker, no new server defect. |
| Typecheck/lint/format/build/bridge/OpenAPI | Not rerun because no production or server files changed; no Q1 evidence code was added. |

Safety counts from the current direct/lower-layer receipts:

- Ordinary Ozon mandatory control calls: `0`.
- Ordinary WB mandatory control calls: `0`.
- Ordinary AI-delivery mandatory control calls: `0`.
- Provider UNKNOWN automatic replay: `0`.
- Known-response provider redispatch: `0`.
- AI UNKNOWN automatic resend: `0`.
- Confirmed delivery duplicate: `0`.
- Provider calls caused by transfer: `0` in accepted transfer evidence; current replay deferred.
- Provider calls caused by backup: `0`.
- AI sends caused by transfer: `0`.
- AI sends caused by backup: `0`.
- Raw server secret persistence: not observed in accepted privacy scans.
- Raw seller report/provider-file persistence: not observed in accepted privacy scans.
- Transfer ciphertext persistence: not observed on server; local encrypted-file route only.
- Backup auto-upload: `0`; no cloud route exists.
- Backup password/server transport: password remains local to the file operation;
  no server transport was observed.
- Ordinary Health heartbeat: none; Health freshness does not truncate valid
  autonomous grace.

## Deferred ledger

- Q1-B: system Chrome native reproduction and other browser families remain
  outside this lane.
- Q1-C: owner-authenticated ChatGPT/Alice, Seller Agents owner account, real
  marketplace rights, live expiry/identity, and owner-only logout UX remain
  deferred.
- Q1-D: admin/preprod/prod isolation, backup/restore, rollback, release,
  publication, and store compatibility remain deferred.
- Q1-E: Stream-2 monitoring consumption remains deferred.
- Owner-deferred items preserved: `OWNER_DEFERRED_TEST-I1-ONLINE-WORK-HEALTH-20260917`;
  `PROVISIONAL_OWNER_REVIEW-HEALTH-TTL-20260917`;
  `PROVISIONAL_OWNER_REVIEW-OFFLINE-ACTIVE-CONTINUATION-20260918` (superseded by owner);
  `PROVISIONAL_OWNER_REVIEW-D3S2-TRANSFER-CRYPTO-20260918`;
  `PROVISIONAL_OWNER_REVIEW-D3S2-TRANSFER-METADATA-RETENTION-20260918`;
  `PROVISIONAL_OWNER_REVIEW-D3S2-EXPORT-KDF-20260918`; and
  `PROVISIONAL_OWNER_REVIEW-D3S2-EXPORT-IMPORT-LIMITS-20260918`.
- Environment-deferred items: native/system Chrome MV3 registration;
  `ENVIRONMENT_DEFERRED-Q1A-CURRENT-PACKAGE-TRANSFER-REPLAY`;
  `ENVIRONMENT_DEFERRED-A24-TRANSFER-INSTALLED-RERUN-20260918`; and
  `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`.
- Stream-2 implementation files modified: **No**.

## Closure and next task

There are no genuine current-package functional defects evidenced by the
reachable source/extracted replay. Q1-A is not ready for architect acceptance
because the required installed native MV3 boundary did not register the worker,
the recorded configured archive is not available for byte testing, and current
package A22/A23 replay remains environment-deferred. The exact recommendation
is:

`Q1A_PARTIAL_ENVIRONMENT_DEFERRED`

Recommended next task after architect Q1-A review:

`Q1-A-R1 — provision a clean task-owned Chromium MV3 environment and recover
the recorded/configured package artifact, then rerun Q1A-01..Q1A-91 installed
matrix and the current-package A22/A23 transfer replay before any Q1-B/Q1-C
lane.`

## Explicit answers

1. Unified Ozon/WB installed matrix: **not fully passable in this executor**;
   current source/extracted behavioral evidence is green and native installed
   proof is deferred.
2. Multiple stores: **lower-layer isolated; current native popup proof deferred**.
3. Ozon Seller-only without Performance: **yes in current A24/helper evidence**.
4. New/historical Start, Resume, store and marketplace change: **yes in current
   C3H lower-layer evidence; native installed proof deferred**.
5. Old commands remain non-autorun: **yes, C3H AUT-29**.
6. Finish fences later work/delivery: **yes, C3F/P2/C3H**.
7. Multi-command and mutation safety: **yes in current core/I1 evidence**.
8. Report lifecycle no hidden poll/no replay: **yes in P1/P2/C3H evidence**.
9. Large/binary/file handling: **binary/file path yes; large-JSON native installed
   proof deferred**.
10. Restart/double-click/UNKNOWN avoid provider replay: **yes**.
11. Delivery UNKNOWN avoids automatic resend: **yes**.
12. Synthetic account isolation: **lower-layer yes; current installed run did
   not reach the worker**.
13. Beta access/capacity: **server fixture and accepted server evidence exist;
   current installed popup race not reached**.
14. Parallel dialogues/stores/providers: **yes in C3H/D3S2 lower-layer evidence**.
15. Server outage preserves valid autonomous Start/Resume/rebind: **yes**.
16. Recovery converges without undoing newer state: **yes**.
17. Duplicate requestId/late ACK/clock skew: **yes**.
18. Known 429: **yes, bounded Retry-After/no hidden retry**.
19. A22/A23: **accepted bounded evidence preserved; current-package replay exactly
   environment-deferred with no relevant product diff**.
20. A24: **current source/extracted helper replay passes; native installed route
   deferred**.
21. FRESH and STALE_BUT_OFFLINE_GRACE_ELIGIBLE: **yes**.
22. CACHE_EXPIRED/revoked/mismatch: **deny as required**.
23. Health freshness separate from autonomous grace: **yes**.
24. Ordinary Ozon mandatory control calls: **0**.
25. Ordinary WB mandatory control calls: **0**.
26. Ordinary AI-delivery mandatory control calls: **0**.
27. Provider UNKNOWN auto replay: **0 observed**.
28. AI UNKNOWN automatic resend: **0 observed**.
29. Privacy/server-storage regression: **none observed**.
30. Stream-2 implementation files modified: **No**.
31. Genuine Q1-A automated product blockers: **none evidenced**; environment
   and artifact blockers remain.
32. Next task: **Q1-A-R1 clean Chromium MV3/package-artifact recovery and full
   current-package replay**, after architect review.

## R1 — canonical MV3 recovery and installed replay closure

Work ID: `Q1-A-R1-20260919-CANONICAL-MV3-RECOVERY-PACKAGE-IDENTITY-AND-INSTALLED-REPLAY`.

This section is an additive R1 receipt. The original Q1-A report above is
preserved unchanged. R1 does not self-accept Q1-A and did not start Q1-B,
Q1-C, Q1-D, Q1-E, S1.2, deployment, publication, or monetization.

### R1 Git and remote truth

- Start HEAD/tree: `9f1ee8772c09a686c334c847bb918ef39396e802` /
  `f62cfc13483bed8800b9abdacb99ec1aaa51318f`.
- Branch: `feature/q1-a-installed-unified-matrix-2026-09-19`.
- The accepted D3/S2 comparison base is `79893dd1f9f9e54dd9959b8ffdef83f7cf4fc0dd` /
  `e4873743e0483239131df0cb47edfa4795b54bae`.
- `git diff 79893dd..9f1ee877 -- apps/extension packages/bridge-core
  packages/marketplaces migration/reference tooling/build` is empty. The
  complete commit diff is the prior Q1-A documentation file only.
- Live `git ls-remote` verified:
  `origin/main=bc718cc5c677ad0eb4598e7de3ad766473ff0847`,
  `origin/integration/i1-c1-srv5-2026-09-16=23047b3bdc22842a5b17e29e3d3f603c0ee51b16`,
  `origin/docs/roadmap-autonomy-correction-2026-09-18=6a48af8cd19137aaa10688c36cb064d3c4b16969`.
- The pre-existing untracked `packages/server/**` symlink directories and
  `repro/` were not staged, modified, or removed. Stream-2 implementation
  paths `apps/health-runner/**`, `packages/server/health/**`, and
  `tooling/api-watch/**` were not modified.
- No push was attempted. `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION` remains;
  no remote Q1-A publication or `REMOTE_VERIFIED` claim is made.

### R1 environment inventory and safe cleanup

Initial inventory recorded `/dev/vda1` 59G total, approximately 56G used and
553MB available (94–100% reported by the two filesystem tools). The only
mounted writable root filesystem is `/dev/vda1`; `/run`, `/dev/shm`, and
`/run/user/0` are tmpfs. Current post-replay availability is approximately
498–506MB.

Task/runtime inventory:

- Repository: `/root/runtime-fixtures` (about 1.5G including existing
  dependencies and preserved untracked content).
- Playwright cache: `/root/.cache/ms-playwright` (about 656M), containing
  `chromium-1234`, `chromium_headless_shell-1234`, and `ffmpeg-1011`.
- Playwright registry link: `/root/.cache/ms-playwright/.links/648adff9348a7311130054e1b2426ffd46b537ad`, pointing at Playwright Core `1.62.1`.
- Python Playwright package: `1.62.0`; repository Playwright Core and test
  package: `1.62.1`.
- Task-created R1 build/probe/replay directories were kept until the receipt
  was complete. No additional deletion was performed in R1: remaining
  temporary directories and all running Docker resources were not proven
  disposable and owner-exclusive. No repository, evidence, owner data,
  Stream-2 data, browser cache, or Docker volume was deleted.
- Docker showed active task/project containers, including
  `d3s2-r1-postgres-20260918` and `d3s2-r1-e2e-postgres`; no stopped
  task-owned container/volume met the safe-removal rule.
- Node environments: system `node v12.22.9`; canonical `/root/.nvm/versions/node/v24.20.0/bin/node v24.20.0`; with Node 24 on PATH, `npm 11.19.0` and `pnpm 10.34.5`. The repository pins `pnpm@10.34.5`.

Available browser executables and versions:

| executable | version | R1 use |
|---|---|---|
| `/usr/bin/google-chrome` → system Chrome | Google Chrome 147.0.7727.116 | differential only |
| `/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` | Chrome for Testing 151.0.7922.34 | canonical installed acceptance |
| `/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell` | Chrome for Testing 151.0.7922.34 | lower-layer/browser package support |
| `/root/.agent-browser/browsers/chrome-149.0.7827.155/chrome` | Chrome for Testing 149.0.7827.155 | available candidate, not selected |
| `/root/.cloakbrowser/chromium-146.0.7680.177.5/chrome` | Chromium 146.0.7680.177 | available candidate, not selected |

Previous evidence and scripts explicitly identify Chrome for Testing
`151.0.7922.34` and `channel: "chromium"`; the managed executable was
recovered locally, not downloaded or assumed absent. Existing Playwright
persistent profiles were task-temporary profiles under `/tmp` and were
created/cleaned by the harness; no owner browser profile was used.

### R1 browser differential

The same minimal unpacked MV3 probe was run against a runtime reconstructed
from the accepted base and the current Q1-A tree. The production paths are
byte-identical because the complete commit diff between the two heads is
documentation-only. Each row below was run with a fresh persistent profile.

| browser | accepted D3/S2 base | current Q1-A tree | result |
|---|---|---|---|
| System Chrome 147.0.7727.116 | no worker after 5s; no ID/URL/popup | no worker after 5s; no ID/URL/popup | `PRE_EXISTING_SYSTEM_CHROME_MV3_ENVIRONMENT_FAILURE` / harness differential, not product |
| Canonical Chromium 151.0.7922.34 | worker registered; popup loaded | worker registered; popup loaded | same extension semantics; no Q1-A regression |

Canonical probe details: both candidates used MV3
`service_worker_entry.js`; each returned a `chrome-extension://…` worker URL,
`chrome.runtime.getManifest()` succeeded, and `popup.html` loaded with title
`Seller Agents`. The exact final configured package independently repeated the
same result. No worker console error or manifest/runtime error was observed.

### R1 package identity differential

The old exact `0166cd…` archive was not found in the repository, task-owned
artifact/cache directories, `/tmp`, or `/var/backups`; its committed receipt
does not contain per-file hashes. The available differential is therefore
against the fixture-neutral rebuild, plus the committed configured receipt:

| candidate | size | SHA-256 | build input |
|---|---:|---|---|
| accepted configured receipt | 2,076,761 | `0166cd246f5b37229caa1f33f284db5c4530892498882c0659e3e6759fcfedc6` | `SA_PACKAGED_CONFIG_JSON` synthetic configured trust/origin prefix |
| R1 fixture-neutral rebuild | 2,075,976 | `5f023926ce9fb140766b25fdb4dbe104ce5861f4996d2d3f01b5817aeca64b9c` | no packaged-config override |
| R1 final configured package | 2,076,761 | `0d23e0e195f42c4ccc7f3492c606cf95129332aef33b6ce90a495a589f9331e8` | one fresh synthetic configured trust key; all installed R1 runs |

The exact cause of the `0166cd…` to `5f0239…` size change is the omitted
generated packaged configuration: it removes a 785-byte prefix from
`service_worker.js`. It is not a production-source change, line-ending change,
dependency/toolchain change, timestamp change, ZIP ordering change, mode
change, or archive-only metadata change. The old byte stream is unavailable,
so byte-for-byte old archive comparison and old per-file hash comparison are
not claimed. Classification:
`PACKAGE_GENERATED_BYTES_CHANGED` plus
`PACKAGE_ARTIFACT_UNAVAILABLE_FOR_DIFFERENTIAL`.

The final configured package differs from the fixture-neutral candidate in
exactly one packaged file: `service_worker.js`, 570,678 → 571,463 bytes;
its SHA-256 is `0c2975deb8ac05f52879469f47514d8796ff33470faaeddc0e43e20dc2e4041f`
versus `9486f6fe8b4bd35c9ee2a8a68cbcc597b5692df31ba040e5039373a6b6d7b32b`.
The other 38 file hashes and sizes are identical. The 785-byte generated
prefix is the configured synthetic trust/origin input required by installed
authority fixtures.

### R1 final package receipt

- Name: `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`.
- Exact SHA-256: `0d23e0e195f42c4ccc7f3492c606cf95129332aef33b6ce90a495a589f9331e8`.
- ZIP size: `2,076,761` bytes; runtime files: `39`; extracted files: `39`;
  ZIP entries: `39`; duplicate entries: none.
- Repeat build with the same recovered configuration produced the same SHA and
  size: `PASS`.
- Source/generated runtime = extracted runtime: `39/39` exact byte parity.
- All 36 JavaScript files: Node 24 `--check` `PASS`; failures `0`.
- ZIP entries are sorted, `ZIP_STORED`, timestamp `(1980,1,1,0,0,0)`, Unix
  mode `0644`, create-system `3`; metadata is normalized and repeat-stable.

Per-file final receipt (`path bytes sha256`):

```text
attachment_delivery_port_content.js 28802 087fe504224634b610c8e27d075bb36f665a4c5f2503e828ea9b4fa8136a99ec
attachment_delivery_wake_content.js 759 6b3a7a4b25ce6a86a9e7b54c0a71a29c02aad9480cfbe7d2a0007e9ca4c9aa11
content_script.js 136205 6f3f156d980caf94f16f1079bd9786a1c6ca673ce08448659220f75367484c79
manifest.json 2479 54e14ea28fb8bbb11adfc1cadf016d7aabd4914b182eeb9a50d9cb7f9375ec26
popup.css 2152 2a8f4eba8a461dc81e3a7348babd95e71da843c35db1d60da30aae449f4fb43d
popup.html 6734 9168c22e1a4996946c2242b2e4b15789c9833c986add020d2419a7d6ba56fdbb
popup.js 16690 70eacd6d7ea9ca7fd646b85da94ac61697f4631da24c9872393fc16504f1c095
service_worker.js 571463 0c2975deb8ac05f52879469f47514d8796ff33470faaeddc0e43e20dc2e4041f
service_worker_entry.js 1810 895daa2b1e11c2129e5d075bf738313fd5a689e1a0b30ab4a11dcbbb075866fc
shared/ai_adapters.js 22597 4b9423666cf7bed03f89edb3c23d535bd02143e85c1a1b7317d184f25cc1bb72
shared/ai_delivery_capabilities.js 9753 dca544904ae1aac578e52f60883c603cee4129fe56089f807ec175cef4e2e83a
shared/application.js 138529 574ca95eb9dd752640455035149f7adddce41f0a91d53e4dfd2faf2cfe3736fe
shared/bootstrap_verifier.js 17369 1e62c7718762b6ac58e2939919c90196472aa604da8e6aad927aaddc35dc05e6
shared/bridge_autorun_model.js 21583 4e3e0fcd18c4d2e72c3758419f7fbb082e6a75e8d444913ec8b0dfdc0ea0b360
shared/composer_send.js 8267 3e9421e8e1bc209af6358e8d957e558301763572a42875b95c8973ca75b736
shared/conversation_identity.js 4027 939036acd95ccb3dfe00f05b5d49568615f6d798a023a0ec995e38267fb68f57
shared/direct_binary_file_delivery_patch.js 10569 a1a54bfa55f4e3544b60f39f5cc1c4c4d5b9492776a34d4bdb4961a88d937786
shared/file_delivery_model_policy.js 4021 caba2a05701d74879bc699316530575c63106a62f8f782eee694ef1c3b4b5aab
shared/file_delivery_port_worker.js 41779 a98c52d0dcdc38408058d04a23602fda6f51f03086db38960fe45438e8d427ff
shared/file_delivery_wake_worker.js 1750 ec1b59ba7243bf4a5591bdbe10b0b5f6e727f8769b08833da156378d202acffd
shared/live_runtime_v0122_patch.js 21042 b496fe501ca13860abf501833e4fb34d588103645047a41dbb568cc45228a79d
shared/llm_output_report_workflow_patch.js 15664 a564e2dbafb3980bd406e82744c177a34df2279b63c3198395c13126520dbbff
shared/manual_controls.js 10269 81f302487da7b5ff7c1b746298353438b2cfec100a5bb8f7fa2c80d1e033c81e
shared/mixed_batch_discovery.js 6054 5daff1af1af6244068258e27cf77e4a814192c1019b3bf3e73dcb9c63a0619ad
shared/ozon_contract.js 321332 96c3a97ba167b4cd7971bba76bd1cb29f3a149f26cb405d60be5eae5fd2bb520
shared/ozon_credentials.js 4085 286c6021f958e41912842569bcfa0d0dfe920eed8ce1646014899a1de064415d
shared/ozon_entitlements.js 58578 f8b9222368a2e3bbfb323ab5cd0fe1c3238742d5c06ef9afac752861d4c7422b
shared/ozon_guidance.js 10926 346da9b83082f5b8246cab7c5aa6afb2e5f04b14d225384ab267f803a030de3e
shared/ozon_operation_registry.js 225182 b42b51f815c0f88e89e1cd193d28cc4f72949d5dd1738ab35d473b226fd0a832
shared/ozon_provider.js 37513 fac8808f90bab2eebef928166aee2ba8daf7965d3b5cb8ea93bf0b1e9085c31d
shared/performance_report_continuation_patch.js 5181 f42115e8ac4197fef8b7f5ba463bc6303e3d425a9202c95605edc3844b34a9b5
shared/proven_writing_block_capture.js 14614 5b0eaac9619cb827d1e74c61f53e2755c084a1d4b60c64d23f5fd4a5354c3aef
shared/provider_transport_core.js 37467 97f9a8bed0427753168c8ff083191338225cbe3abd026b471876daf19e04bba4
shared/runtime_names.js 10640 d502b11ef8d772dfc42499991d3307c7d18aa0bc1e5bb269a7b57a1f08582b0f
shared/swagger_read_surface_patch.js 57274 252274d629e635258f4c18a00ee90b02dc0d2d277945328986e4f49066b1ae06
shared/wb_adapter.js 168907 a876a017d17c539fe35b050a3f18c1c1dea870547c1ae996c235b4c48524e700
shared/web_file_attachment.js 4750 a1d91cb7b6aa5b1b26bf780e29f3d42895510b04d55d37569cfc3d3cf4db3010
shared/work_session_model.js 2627 95730ec62b91ee32c598b502d73c8fcaa76499f4ff5c740648a49fc64bdf8c8d
shared/xlsx_direct_binary_delivery_patch.js 12156 5e61f6d749cf69d980b4d9bdae8b32bb0937e48a298abd4afd9793241252c3fa
```

### R1 installed replay and Q1A matrix

All installed receipts below use the one final configured package identity
`0d23e0e195f42c4ccc7f3492c606cf95129332aef33b6ce90a495a589f9331e8`.
Source/generated and extracted/package forms are two parity forms of this same
package, not different acceptance candidates.

Installed receipts:

- Native C1: `BR-C1-01..36 PASS` on source/generated and extracted/package;
  popup Start/Resume, store/context fencing, Finish fencing, duplicate UI,
  old-command non-autorun, worker recovery, zero provider calls.
- C2 offline: `BR-C2-01..05 PASS`.
- Store metadata: `BR-STORE-01..13 PASS` on both forms; real popup,
  chrome.storage, tombstone/revision/restart/reconciliation paths; provider and
  ordinary mandatory control traffic `0`.
- R4 transport: `SYNC-R4-01..05 PASS` on both forms over installed HTTP,
  including independent installation, duplicate request ID, stale ACK, and
  secret-free sync payload.
- P1 provider outcome: all emitted installed P1 rows `PASS`; UNKNOWN has no
  automatic provider replay.
- P2 result recovery: all emitted installed rows `PASS`; Delivery UNKNOWN has
  zero automatic additional sends.
- P3 scheduler: source/extracted `PASS`, one restart, 100-wake check,
  `marketplace_requests=0`, periodic scheduler alarms `0`.
- A24: installed export, same-account clean import, wrong password, tamper,
  conflicts, account mismatch, legacy/unknown rejection all `PASS` on both
  forms; four stores; provider requests `0`; mandatory control requests `0`.
- The standalone `browser_verified_health_authority.py` helper returned a
  denied valid claim because its fixture authority shape/key context is not
  compatible with the configured package. This is `SYNTHETIC_FIXTURE_DEFECT` /
  `HARNESS_DEFECT`; integrated C1 authority/Health cases pass and no product
  patch was made.
- A current-package transfer provisioning attempt timed out waiting for its
  test API at `127.0.0.1:43102/health/ready` before any transfer case. The
  harness captures the child API output rather than surfacing it. This is
  `DISK/DB_ENVIRONMENT_DEFECT` / `HARNESS_DEFECT`, not a transfer assertion.
  Because the transfer runner builds its own configured fixture package, that
  failed attempt is not counted as a current-final-package PASS. A22/A23 stay
  `ENVIRONMENT_DEFERRED-Q1A-CURRENT-PACKAGE-TRANSFER-REPLAY`; accepted A22/A23
  evidence remains valid because the transfer production diff is empty.

| ID | final status | boundary/evidence |
|---|---|---|
| Q1A-01 | `INSTALLED_PASS` | C1/store popup marketplace switch |
| Q1A-02 | `INSTALLED_PASS` | Store metadata popup, multiple Ozon identities |
| Q1A-03 | `INSTALLED_PASS` | Store metadata/A24, multiple WB identities |
| Q1A-04 | `INSTALLED_PASS` | A24 installed Seller-only shape |
| Q1A-05 | `INSTALLED_PASS` | A24 installed Seller+Performance shape |
| Q1A-06 | `INSTALLED_PASS` | Store metadata popup rename/revision |
| Q1A-07 | `INSTALLED_PASS` | Store metadata popup delete/tombstone |
| Q1A-08 | `INSTALLED_PASS` | C1 BR-C1-01 synthetic Start |
| Q1A-09 | `INSTALLED_PASS` | C1 BR-C1-02 historical Start |
| Q1A-10 | `INSTALLED_PASS` | C1 BR-C1-03 Resume |
| Q1A-11 | `INSTALLED_PASS` | C1 BR-C1-20..29 store change/rebind |
| Q1A-12 | `INSTALLED_PASS` | C1 marketplace/context fencing |
| Q1A-13 | `INSTALLED_PASS` | C1 BR-C1-15/22..24 Finish fencing |
| Q1A-14 | `INSTALLED_PASS` | C1 popup lifecycle/visibility paths |
| Q1A-15 | `INSTALLED_PASS` | C1/P1 installed command paths |
| Q1A-16 | `INSTALLED_PASS` | P1 installed command/report ordering paths |
| Q1A-17 | `INSTALLED_PASS` | P1 fail-closed invalid/unknown command paths |
| Q1A-18 | `INSTALLED_PASS` | P1 unknown operation/host fencing |
| Q1A-19 | `INSTALLED_PASS` | P1 mutation/read-only safety |
| Q1A-20 | `INSTALLED_PASS` | P1 installed report START |
| Q1A-21 | `INSTALLED_PASS` | P1 not-ready response/no hidden poll |
| Q1A-22 | `INSTALLED_PASS` | P1 ready report lifecycle |
| Q1A-23 | `INSTALLED_PASS` | P2/A24 installed materialization paths |
| Q1A-24 | `INSTALLED_PASS` | P1 UNKNOWN terminal/no repeat |
| Q1A-25 | `INSTALLED_PASS` | P2/C1 restart local-state recovery |
| Q1A-26 | `LOWER_LAYER_PASS_ONLY` | Large-JSON-specific popup receipt not emitted by installed batch |
| Q1A-27 | `LOWER_LAYER_PASS_ONLY` | XLSX/binary focused receipt remains lower-layer |
| Q1A-28 | `LOWER_LAYER_PASS_ONLY` | Original provider-file focused receipt remains lower-layer |
| Q1A-29 | `LOWER_LAYER_PASS_ONLY` | Buffer bound receipt remains P2/P3 lower-layer |
| Q1A-30 | `LOWER_LAYER_PASS_ONLY` | Buffer expiry focused receipt remains lower-layer |
| Q1A-31 | `LOWER_LAYER_PASS_ONLY` | Transaction-failure focused receipt remains lower-layer |
| Q1A-32 | `INSTALLED_PASS` | C1/P3 worker restart |
| Q1A-33 | `INSTALLED_PASS` | C1/P3 persistent context restart |
| Q1A-34 | `INSTALLED_PASS` | C1 double-click single-flight |
| Q1A-35 | `INSTALLED_PASS` | P1 provider UNKNOWN no replay |
| Q1A-36 | `INSTALLED_PASS` | P2 delivery UNKNOWN no resend |
| Q1A-37 | `INSTALLED_PASS` | P2 confirmed delivery no duplicate |
| Q1A-38 | `LOWER_LAYER_PASS_ONLY` | Current installed account A/B browser run not emitted |
| Q1A-39 | `LOWER_LAYER_PASS_ONLY` | Logout fence covered by lower-layer/C1 reset paths |
| Q1A-40 | `LOWER_LAYER_PASS_ONLY` | Synthetic BETA popup access not emitted in current batch |
| Q1A-41 | `LOWER_LAYER_PASS_ONLY` | Last-slot race is server/lower-layer evidence only |
| Q1A-42 | `LOWER_LAYER_PASS_ONLY` | Capacity-reached installed flow not emitted |
| Q1A-43 | `LOWER_LAYER_PASS_ONLY` | Admin-authorized increment is not a Q1-A UI receipt |
| Q1A-44 | `INSTALLED_PASS` | C1 distinct dialogues/same store |
| Q1A-45 | `INSTALLED_PASS` | C1/store metadata different stores |
| Q1A-46 | `INSTALLED_PASS` | C1 Ozon/WB separation |
| Q1A-47 | `INSTALLED_PASS` | C1 multiple dialogue tabs |
| Q1A-48 | `INSTALLED_PASS` | R4 independent persistent installation |
| Q1A-49 | `INSTALLED_PASS` | C2 offline new Start |
| Q1A-50 | `INSTALLED_PASS` | C2 offline Resume |
| Q1A-51 | `INSTALLED_PASS` | C2/store offline store change |
| Q1A-52 | `INSTALLED_PASS` | C2/C1 marketplace change |
| Q1A-53 | `INSTALLED_PASS` | Store metadata offline mutation |
| Q1A-54 | `INSTALLED_PASS` | R4 recovery/reconcile |
| Q1A-55 | `INSTALLED_PASS` | R4 disconnected/unknown remote state |
| Q1A-56 | `INSTALLED_PASS` | R4 duplicate requestId |
| Q1A-57 | `INSTALLED_PASS` | R4 stale revision |
| Q1A-58 | `INSTALLED_PASS` | R4 late ACK |
| Q1A-59 | `INSTALLED_PASS` | C1/R4 late delivery after Finish |
| Q1A-60 | `INSTALLED_PASS` | C1/R4 late delivery after store switch |
| Q1A-61 | `INSTALLED_PASS` | C1 authority clock/context fencing |
| Q1A-62 | `INSTALLED_PASS` | C1/R4 preferred-executor anti-flap path |
| Q1A-63 | `LOWER_LAYER_PASS_ONLY` | Installed quota coordination receipt not reached |
| Q1A-64 | `LOWER_LAYER_PASS_ONLY` | Installed 429/Retry-After receipt not reached |
| Q1A-65 | `LOWER_LAYER_PASS_ONLY` | Installed authority-before-retry receipt not reached |
| Q1A-66 | `LOWER_LAYER_PASS_ONLY` | Second-installation quota lease receipt not reached |
| Q1A-67 | `ENVIRONMENT_DEFERRED` | Current-final-package A22 happy path; clean API/DB provisioning timed out |
| Q1A-68 | `ENVIRONMENT_DEFERRED` | Current-final-package Ozon Seller+Performance transfer |
| Q1A-69 | `ENVIRONMENT_DEFERRED` | Current-final-package WB transfer |
| Q1A-70 | `ENVIRONMENT_DEFERRED` | Current-final-package source offline/discovery |
| Q1A-71 | `ENVIRONMENT_DEFERRED` | Current-final-package tamper/replay |
| Q1A-72 | `ENVIRONMENT_DEFERRED` | Current-final-package account/device isolation |
| Q1A-73 | `ENVIRONMENT_DEFERRED` | Current-final-package durable-storage privacy audit |
| Q1A-74 | `INSTALLED_PASS` | A24 installed encrypted multi-store export |
| Q1A-75 | `INSTALLED_PASS` | A24 clean-profile same-account import |
| Q1A-76 | `INSTALLED_PASS` | A24 wrong password/tamper |
| Q1A-77 | `INSTALLED_PASS` | A24 account mismatch |
| Q1A-78 | `INSTALLED_PASS` | A24 conflict set/tombstone/provider/marketplace |
| Q1A-79 | `INSTALLED_PASS` | A24 server unavailable/local-only |
| Q1A-80 | `INSTALLED_PASS` | A24 zero Work/provider/AI side effects |
| Q1A-81 | `INSTALLED_PASS` | C1 fresh synthetic authority Start |
| Q1A-82 | `INSTALLED_PASS` | C2 signed offline continuation/grace |
| Q1A-83 | `LOWER_LAYER_PASS_ONLY` | Exact grace-boundary authority receipt is lower-layer |
| Q1A-84 | `LOWER_LAYER_PASS_ONLY` | Exact cache-expired authority receipt is lower-layer; C1 expired Health is not substituted |
| Q1A-85 | `INSTALLED_PASS` | C2 tampered durable signed authority |
| Q1A-86 | `LOWER_LAYER_PASS_ONLY` | Known-revocation-specific installed receipt not emitted |
| Q1A-87 | `LOWER_LAYER_PASS_ONLY` | Account-mismatch authority-specific receipt not emitted |
| Q1A-88 | `LOWER_LAYER_PASS_ONLY` | Device/session-mismatch authority-specific receipt not emitted |
| Q1A-89 | `INSTALLED_PASS` | C1 credentialRevision fence before Work |
| Q1A-90 | `INSTALLED_PASS` | C1 deleted-store fence |
| Q1A-91 | `LOWER_LAYER_PASS_ONLY` | Health-freshness/grace independence remains lower-layer; no heartbeat observed |

Q1A-26..31, Q1A-38..43, Q1A-63..66, Q1A-83..84, Q1A-86..88, and Q1A-91
remain lower-layer only for this R1 receipt. They are not converted to final
installed PASS. Rows 67–73 remain environment-deferred rather than lower-layer
substitutions. No Q1A row is an installed failure.

### R1 failure batch and regression ledger

| classification | findings |
|---|---|
| `PRODUCT_DEFECT` | none evidenced |
| `PACKAGE_DEFECT` | none; configured package parity and canonical run pass |
| `HARNESS_DEFECT` | standalone verified-health helper uses an incompatible fixture authority shape/config; direct lower-layer invocations that inject a second config fail `AUTH_REQUIRED` before product behavior |
| `SYNTHETIC_FIXTURE_DEFECT` | same authority helper mismatch; no product patch justified |
| `BROWSER_ENVIRONMENT_DEFECT` | system Chrome 147 worker registration failure on both accepted and current trees |
| `DISK/DB_ENVIRONMENT_DEFECT` | transfer API readiness timed out at `127.0.0.1:43102/health/ready`; no current-final-package transfer claim |
| `OWNER_ONLY` | live owner account, real ChatGPT/Alice/provider/marketplace rights remain Q1-C |
| `STREAM2_DEPENDENCY` | monitoring consumption remains Q1-E; no implementation dependency was changed |

Regression identity: D3S2, A22/A23, A24, C3E, C3F, C3G, C3H, P1, P2, P3,
100-wake, Extension Core, Extension I1, and application lower-layer receipts
remain accepted supporting evidence on unchanged production bytes. Installed
C1/C2/store/R4/P1/P2/P3/A24 reruns above pass on the exact final package. No
server/API/OpenAPI/integration gate was affected by the empty production diff;
the current transfer server fixture was provisioned only until its readiness
timeout and is not a pass.

### R1 safety and privacy receipt

- Ordinary Ozon mandatory control calls: `0`.
- Ordinary WB mandatory control calls: `0`.
- Ordinary AI-delivery mandatory control calls: `0`.
- Provider UNKNOWN automatic replay: `0`.
- Known-response provider redispatch: `0`.
- Delivery UNKNOWN automatic resend: `0`.
- Confirmed duplicate delivery: `0`.
- Ordinary Health heartbeat: `0`.
- Command-time mandatory Bootstrap: `0`.
- A24 provider requests, mandatory control requests, Work sessions, and AI
  sends: `0` for the backup flow.
- Synthetic unique markers found no server persistence of marketplace
  credentials, raw report, provider file, raw command body, AI message body,
  storageState, raw Health envelope, transfer ciphertext, backup plaintext, or
  backup password. Backup auto-upload: `0`; password transport: `0`.

### R1 deferrals and closure

- Q1-B: browser-family matrix, including system Chrome as a browser-family
  acceptance lane, Opera/Yandex/Firefox/Safari/macOS: deferred to Q1-B.
- Q1-C: owner-authenticated live AI/provider/account/marketplace rights,
  owner-live logout and A13: deferred to Q1-C. Synthetic installed AI fixtures
  above do not claim live-owner acceptance.
- Q1-D: admin/preprod/release/rollback/publication/store compatibility:
  deferred to Q1-D.
- Q1-E: Stream-2 monitoring consumption: deferred to Q1-E.
- Owner-deferred/provisional decisions from the prior D3/S2 ledger remain
  unchanged.
- Environment-deferred: system Chrome MV3 route, current-final-package
  A22/A23 replay, transfer API/DB fixture readiness, and
  `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`.

Recommended disposition: `Q1A_PARTIAL_ENVIRONMENT_DEFERRED`, not acceptance.
There is no genuine current-package Q1-A product blocker evidenced. Q1-A is
not ready for architect acceptance because the full installed matrix still has
explicit lower-layer-only rows and current-final-package A22/A23 replay is
environment-deferred. The next task after architect review is a bounded clean
task-owned transfer API/DB fixture provisioning and rerun of Q1A-26..31,
Q1A-38..43, Q1A-63..66, Q1A-67..73, and Q1A-81..91 where the architect requires
installed proof; do not start Q1-B/C/D/E before that review.

## R2 — clean fixture, remaining installed matrix, and transfer replay

Work ID: `Q1-A-R2-20260919-CLEAN-FIXTURE-REMAINING-INSTALLED-MATRIX-AND-TRANSFER-REPLAY`.

### R2 identities and environment

- Start HEAD/tree: `94e00eeaa371f4bcc10f8d2d5781b6214c12d25a` /
  `0a724cdb94eae132cfc2a6ce5fb50d62be08f050`; branch:
  `feature/q1-a-installed-unified-matrix-2026-09-19`; accepted ancestry remains
  `79893dd1f9f9e54dd9959b8ffdef83f7cf4fc0dd`.
- Verified remote heads: `origin/main=bc718cc5c677ad0eb4598e7de3ad766473ff0847`,
  `origin/integration/i1-c1-srv5-2026-09-16=23047b3bdc22842a5b17e29e3d3f603c0ee51b16`,
  `origin/docs/roadmap-autonomy-correction-2026-09-18=6a48af8cd19137aaa10688c36cb064d3c4b16969`.
- Exact package existed in `/tmp` and was not rebuilt: SHA-256
  `0d23e0e195f42c4ccc7f3492c606cf95129332aef33b6ce90a495a589f9331e8`, size
  `2,076,761`, runtime/extracted/ZIP inventory `39/39/39`, source/extracted parity
  `PASS`, repeat archive identity `PASS`. Source and extracted runtimes registered
  MV3 workers in canonical Playwright Chromium `151.0.7922.34` using
  `/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`.
- Disk was approximately `489 MB` free before R2 and `407 MB` free before final
  task-owned database cleanup on the 59 GB root filesystem. Pre-existing untracked
  symlink/repro paths were preserved. Stream-2 paths remained untouched.

### R2 clean PostgreSQL/API fixture

The existing task-owned `d3s2-r1-e2e-postgres` (`postgres:18.0`, loopback port
`55446`) was reused without deleting volumes. Fresh disposable databases
`q1a_r2_20260919_001` through `_006` were created, migrated through `0018`, and
verified with `19` migration records. They contained no owner or production data.
The real API was started with loopback `DATABASE_URL`, synthetic keys, package trust
key ID `browser-fixture-key`, and `PRODUCT_CONTROL_PLANE_E2E=1`; it stayed alive on
`127.0.0.1:43100`, and `/health/ready` returned `200`. The portal fixture was on
`127.0.0.1:43101`. Those task-owned disposable databases were dropped after evidence
capture; the pre-existing container was not removed.

The prior R1 `127.0.0.1:43102/health/ready` timeout was caused by the API child exiting
before listen on a stale fixture collision:
`fixture identity collision for i1-client-one@example.test,i1-client-two@example.test`
at `api-harness.ts:50`. The reused database was not clean. The runner suppressed the
child output and exposed only readiness timeout. It was not a port conflict, disk
failure, migration failure, Node startup failure, dependency wait, or bad health route.
R2 made the fixture key ID configurable so the exact package trust key could be used;
no production route or schema changed.

### R2 complete initial failure batch

| finding | classification | disposition |
|---|---|---|
| Reused-DB API exited on stale identity collision before listen | `SYNTHETIC_FIXTURE_DEFECT` / `HARNESS_DEFECT` | fresh DB and surfaced child output; resolved |
| Reused OTP identity reached deliberate API `429` rate limit | `API_FIXTURE_DEFECT` | fresh synthetic identities; not product |
| WB helper asserted Ozon fields after valid WB import | `HARNESS_DEFECT` | interpretation corrected; no product failure |
| Source-offline custom probe hung in source-reopen helper | `HARNESS_DEFECT` | terminated safely; Q1A-70 remains environment-deferred |
| Exact-package 2B helper reached `/activate` without selectable account | `SYNTHETIC_FIXTURE_DEFECT` / `HARNESS_DEFECT` | no product conclusion; Q1A-38..43, 71..73 remain environment-deferred |
| Standalone verified-health helper used incompatible authority shape/key | `SYNTHETIC_FIXTURE_DEFECT` / `HARNESS_DEFECT` | direct exact-worker replay used; no product patch |
| Client-cache helper used `fixture-key` instead of package `browser-fixture-key` | `SYNTHETIC_FIXTURE_DEFECT` / `HARNESS_DEFECT` | exact package unchanged; no product conclusion |
| System Chrome 147 worker registration issue | `BROWSER_ENVIRONMENT_DEFECT` / Q1-B | remains outside Q1-A |

No `PRODUCT_DEFECT`, `PACKAGE_DEFECT`, `POSTGRESQL_FIXTURE_DEFECT`, or disk-induced
failure was evidenced.

### R2 remaining-row results

- Q1A-26: no exact installed large-JSON receipt; environment-deferred with the
  specific missing installed payload driver. No full payload was committed.
- Q1A-27: exact installed binary paths passed in application/P2, but the required
  deterministic XLSX-specific receipt was not emitted; environment-deferred.
- Q1A-28: original-provider-file-specific installed receipt was not emitted;
  environment-deferred.
- Q1A-29: exact source/extracted P2 materialization and bounded local technical-result
  paths passed with zero additional provider calls; installed pass.
- Q1A-30: exact expiry/wake receipt was not emitted; environment-deferred.
- Q1A-31: exact supported IDB transaction-failure injection receipt was not emitted;
  environment-deferred. P2 unknown-delivery/no-false-success paths passed.
- Q1A-38..43: `p2-auth.integration.test.ts` passed `14/14` and
  `s1-1-beta-admission.integration.test.ts` passed `11/11`, covering free-beta,
  last-slot single winner, capacity closure, existing login, and idempotent mutation.
  The exact-package installed activation helper did not reach account selection, so
  these remain explicit installed-environment deferrals, not lower-layer substitutions.
- Q1A-63..65: exact source/extracted P1 passed local quota, 429/Retry-After, and
  authority-before-retry; no hidden retry or provider replay.
- Q1A-66: second-installation partition/quota receipt was not emitted; environment-deferred.
- Q1A-83/84/86/87/88: direct exact-worker replay passed grace boundary/cache-expired,
  known revocation, account mismatch, and device/session mismatch fail-closed decisions.
- Q1A-91: direct exact-worker replay passed stale Health with valid signed autonomous
  grace (`ALLOW_OFFLINE_GRACE`, `healthRequired=false`) and independent grace expiry.
- Q1A-67/68: exact package, two persistent Chromium profiles, real API, and clean DB
  passed happy path and Ozon Seller+Performance; provider/AI calls were zero.
- Q1A-69: same exact package and real API passed WB transfer with synthetic token hash only.
- Q1A-70: source-offline recovery helper hung before producing a receipt; deferred.
- Q1A-71..73: exact-package 2B activation could not complete; tamper/replay,
  account/device isolation, and durable-storage audit remain deferred. Existing exact
  P1/P2/A24 privacy evidence is supporting evidence only.

### R2 authoritative Q1A-01..91 matrix

Every row marked `INSTALLED_PASS` below used package SHA
`0d23e0e195f42c4ccc7f3492c606cf95129332aef33b6ce90a495a589f9331e8`.

| ID | final classification | package/evidence |
|---|---|---|
| Q1A-01 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-02 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-03 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-04 | `INSTALLED_PASS` | exact SHA; R1 A24 |
| Q1A-05 | `INSTALLED_PASS` | exact SHA; R1 A24 |
| Q1A-06 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-07 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-08 | `INSTALLED_PASS` | exact SHA; exact C1 |
| Q1A-09 | `INSTALLED_PASS` | exact SHA; exact C1 |
| Q1A-10 | `INSTALLED_PASS` | exact SHA; exact C1 |
| Q1A-11 | `INSTALLED_PASS` | exact SHA; exact C1 |
| Q1A-12 | `INSTALLED_PASS` | exact SHA; exact C1 |
| Q1A-13 | `INSTALLED_PASS` | exact SHA; exact C1 |
| Q1A-14 | `INSTALLED_PASS` | exact SHA; exact C1 |
| Q1A-15 | `INSTALLED_PASS` | exact SHA; exact C1/P1 |
| Q1A-16 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-17 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-18 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-19 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-20 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-21 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-22 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-23 | `INSTALLED_PASS` | exact SHA; exact P2 |
| Q1A-24 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-25 | `INSTALLED_PASS` | exact SHA; exact P2/C1 |
| Q1A-26 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | missing installed large-JSON driver |
| Q1A-27 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | missing installed XLSX driver |
| Q1A-28 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | missing installed original-file driver |
| Q1A-29 | `INSTALLED_PASS` | exact SHA; exact P2 materialization |
| Q1A-30 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | missing installed expiry/wake driver |
| Q1A-31 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | missing installed IDB-failure driver |
| Q1A-32 | `INSTALLED_PASS` | exact SHA; exact C1/P3 |
| Q1A-33 | `INSTALLED_PASS` | exact SHA; exact C1/P3 |
| Q1A-34 | `INSTALLED_PASS` | exact SHA; exact C1 |
| Q1A-35 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-36 | `INSTALLED_PASS` | exact SHA; exact P2 |
| Q1A-37 | `INSTALLED_PASS` | exact SHA; exact P2 |
| Q1A-38 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | installed activation account-selection gap |
| Q1A-39 | `INSTALLED_PASS` | exact SHA; exact C1 logout fence |
| Q1A-40 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | installed activation account-selection gap |
| Q1A-41 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | installed activation gap; server 14/14 |
| Q1A-42 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | installed activation gap; server 14/14 |
| Q1A-43 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | installed activation gap; admin 11/11 |
| Q1A-44 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-45 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-46 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-47 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-48 | `INSTALLED_PASS` | exact SHA; R1 R4 |
| Q1A-49 | `INSTALLED_PASS` | exact SHA; R1 C2 |
| Q1A-50 | `INSTALLED_PASS` | exact SHA; R1 C2 |
| Q1A-51 | `INSTALLED_PASS` | exact SHA; R1 C2 |
| Q1A-52 | `INSTALLED_PASS` | exact SHA; R1 C2 |
| Q1A-53 | `INSTALLED_PASS` | exact SHA; R1 C2 |
| Q1A-54 | `INSTALLED_PASS` | exact SHA; R1 R4 |
| Q1A-55 | `INSTALLED_PASS` | exact SHA; R1 R4 |
| Q1A-56 | `INSTALLED_PASS` | exact SHA; R1 R4 |
| Q1A-57 | `INSTALLED_PASS` | exact SHA; R1 R4 |
| Q1A-58 | `INSTALLED_PASS` | exact SHA; R1 R4 |
| Q1A-59 | `INSTALLED_PASS` | exact SHA; R1 C1/R4 |
| Q1A-60 | `INSTALLED_PASS` | exact SHA; R1 C1/R4 |
| Q1A-61 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-62 | `INSTALLED_PASS` | exact SHA; R1 C1/R4 |
| Q1A-63 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-64 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-65 | `INSTALLED_PASS` | exact SHA; exact P1 |
| Q1A-66 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | missing installed second-profile quota receipt |
| Q1A-67 | `INSTALLED_PASS` | exact SHA; real API/DB transfer |
| Q1A-68 | `INSTALLED_PASS` | exact SHA; real API/DB Ozon Seller+Performance |
| Q1A-69 | `INSTALLED_PASS` | exact SHA; real API/DB WB |
| Q1A-70 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | source-reopen helper hung |
| Q1A-71 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | exact 2B activation incomplete |
| Q1A-72 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | exact 2B activation incomplete |
| Q1A-73 | `ENVIRONMENT_DEFERRED_WITH_EXACT_CAUSE` | exact 2B activation incomplete |
| Q1A-74 | `INSTALLED_PASS` | exact SHA; R1 A24 |
| Q1A-75 | `INSTALLED_PASS` | exact SHA; R1 A24 |
| Q1A-76 | `INSTALLED_PASS` | exact SHA; R1 A24 |
| Q1A-77 | `INSTALLED_PASS` | exact SHA; R1 A24 |
| Q1A-78 | `INSTALLED_PASS` | exact SHA; R1 A24 |
| Q1A-79 | `INSTALLED_PASS` | exact SHA; R1 A24 |
| Q1A-80 | `INSTALLED_PASS` | exact SHA; R1 A24 |
| Q1A-81 | `INSTALLED_PASS` | exact SHA; exact C1 |
| Q1A-82 | `INSTALLED_PASS` | exact SHA; R1 C2 |
| Q1A-83 | `INSTALLED_PASS` | exact SHA; exact worker grace boundary |
| Q1A-84 | `INSTALLED_PASS` | exact SHA; exact worker CACHE_EXPIRED |
| Q1A-85 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-86 | `INSTALLED_PASS` | exact SHA; exact worker revocation |
| Q1A-87 | `INSTALLED_PASS` | exact SHA; exact worker account mismatch |
| Q1A-88 | `INSTALLED_PASS` | exact SHA; exact worker device/session mismatch |
| Q1A-89 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-90 | `INSTALLED_PASS` | exact SHA; R1 C1 |
| Q1A-91 | `INSTALLED_PASS` | exact SHA; exact worker stale Health/grace |

### R2 safety, privacy, regression, and governance

- Ordinary Ozon control calls `0`; ordinary WB control calls `0`; ordinary AI-delivery
  control calls `0`; provider UNKNOWN replay `0`; known-response redispatch `0`;
  delivery UNKNOWN resend `0`; confirmed duplicate delivery `0`; ordinary Health
  heartbeat `0`; command-time Bootstrap `0`.
- Transfer-caused provider calls `0`; transfer-caused AI sends `0`; backup-caused
  provider calls `0`; backup-caused AI sends `0`.
- Synthetic markers and exact P1/P2/A24 receipts showed no durable marketplace
  credentials, reports, provider files, command bodies, AI bodies, storageState, Health
  envelopes, transfer ciphertext, backup plaintext, or backup password. The incomplete
  2B privacy replay is not promoted to a new pass.
- Only the fixture harness key-ID selection and this R2 document changed. No server,
  contract, schema, extension, shared client, or Stream-2 implementation changed.
  Focused server regression was `p2-auth 14/14 PASS` and `s1-1-beta-admission 11/11
  PASS`; no full server/client regression was required.
- Q1-B browser-family, Q1-C owner/live AI/provider/account, Q1-D admin/preprod/release,
  Q1-E monitoring consumption, and owner-live choices remain in their owning lanes.
  No row is `LOWER_LAYER_ONLY` in this R2 final table. Remote publication remains
  `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`; no force push or publication occurred.

Recommended disposition remains `Q1A_PARTIAL_ENVIRONMENT_DEFERRED`, not acceptance. No
genuine current-package product defect or automated Q1-A product blocker was found. The
exact next task after architect review is bounded R3 fixture-only completion of the
installed receipt gaps Q1A-26..31, Q1A-38..43, Q1A-66, and Q1A-70..73, followed by
architect review; do not start Q1-B/C/D/E.

## R3 — fixture-only closure attempt and exact-package preflight

Work ID: `Q1-A-R3-20260919-FINAL-FIXTURE-ONLY-INSTALLED-CLOSURE`.

### R3 identity and boundaries

- Start HEAD/tree: `55d38f40e4eb42eaaa65a7fd1d87a6ad733b6796` /
  `b6ff3ca82baf70cf2a71156ccd1b379eede12c2d`; branch:
  `feature/q1-a-installed-unified-matrix-2026-09-19`.
- Accepted ancestry remains `79893dd1f9f9e54dd9959b8ffdef83f7cf4fc0dd`.
- Live remote heads were verified unchanged:
  `origin/main=bc718cc5c677ad0eb4598e7de3ad766473ff0847`,
  `origin/integration/i1-c1-srv5-2026-09-16=23047b3bdc22842a5b17e29e3d3f603c0ee51b16`,
  `origin/docs/roadmap-autonomy-correction-2026-09-18=6a48af8cd19137aaa10688c36cb064d3c4b16969`.
- Stream-2 implementation paths `apps/health-runner/**`,
  `packages/server/health/**`, and `tooling/api-watch/**` were not modified.
- No production code, package source, schema, API route, transfer behavior, or
  browser-store artifact was changed. The only implementation changes are
  fixture/harness identity allocation in `api-harness.ts` and the three
  installed browser helpers.

### Exact package preflight

The required package was not present in the repository, `/tmp`, `/root`, or
the full local filesystem search:

- required SHA-256:
  `0d23e0e195f42c4ccc7f3492c606cf95129332aef33b6ce90a495a589f9331e8`;
- required size/inventory: `2,076,761 bytes; 39 runtime / 39 extracted /
  39 ZIP entries`;
- result: `EXACT_PACKAGE_ARCHIVE_MISSING`.

The available archives have different identities and were not used for any
R3 installed result. Therefore no R3 installed result is combined with another
package identity. Canonical Chromium is installed and reports
`Google Chrome for Testing 151.0.7922.34` at
`/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, but the
required archive could not be loaded for final Q1-A proof.

### Clean fixture and activation correction

The task-owned PostgreSQL 18.0 container `d3s2-r1-e2e-postgres` remained on
loopback port `55446`. A disposable database
`q1a_r3_probe_20260918_001` was created, migrated through 0018, used for the
fixture reproduction, and dropped after capture. The API/portal method remains
the R2 real API on `127.0.0.1:43100` and portal on
`127.0.0.1:43101` (the transfer helper uses its bounded 43102/43103 pair).

The reproduced activation failure was the fixed identity collision:
`i1-client-one@example.test,i1-client-two@example.test`. The API child exited
before listen, so the portal reached activation without selectable account
state. The fixture now allocates a sanitized, stable per-run
`SA_I1_FIXTURE_NAMESPACE` (or a fresh UUID), derives all synthetic identities
from it, and records the namespace/emails in fixture evidence. The installed
helpers use that same namespace, including the shared two-account and 2B
security paths. No authenticated boolean or production bypass was added.

With the corrected fixture, the existing two-profile transfer helper reached
legitimate portal account selection, activated both synthetic profiles, and
completed one transfer on a newly generated development runtime. This was
harness validation only: the generated runtime did not have the required
R3 package SHA and is not counted as an installed Q1-A pass.

### Complete initial failure batch

| scenario | initial outcome / first failure | classification | fix type | final outcome |
|---|---|---|---|---|
| Q1A-26 | no focused installed large-JSON driver; exact archive preflight then failed | TEST_DRIVER_MISSING | test driver required; blocked by missing exact archive | OPEN |
| Q1A-27 | no focused installed XLSX/binary driver; exact archive preflight then failed | TEST_DRIVER_MISSING | test driver required; blocked by missing exact archive | OPEN |
| Q1A-28 | no focused original-provider-file driver; exact archive preflight then failed | TEST_DRIVER_MISSING | test driver required; blocked by missing exact archive | OPEN |
| Q1A-30 | no focused expiry/wake driver; exact archive preflight then failed | TEST_DRIVER_MISSING | test driver required; blocked by missing exact archive | OPEN |
| Q1A-31 | no focused IDB commit-failure driver; exact archive preflight then failed | TEST_DRIVER_MISSING | test driver required; blocked by missing exact archive | OPEN |
| Q1A-38 | activation helper had no selectable account after fixed-identity API collision | FIXTURE_DEFECT | unique namespaced identities; exact replay blocked by missing archive | OPEN |
| Q1A-40 | same activation/account-selection failure | FIXTURE_DEFECT | shared namespaced activation fixture; exact replay blocked | OPEN |
| Q1A-41 | same activation/account-selection failure before installed race | FIXTURE_DEFECT | shared namespaced activation fixture; exact replay blocked | OPEN |
| Q1A-42 | same activation/account-selection failure before installed capacity gate | FIXTURE_DEFECT | shared namespaced activation fixture; exact replay blocked | OPEN |
| Q1A-43 | same activation/account-selection failure before installed admin route | FIXTURE_DEFECT | shared namespaced activation fixture; exact replay blocked | OPEN |
| Q1A-66 | no focused second-installation quota receipt; exact archive unavailable | TEST_DRIVER_MISSING | focused persistent-profile driver required | OPEN |
| Q1A-70 | source-reopen custom helper hung before receipt | HARNESS_DEFECT | bounded close/reopen helper still required | OPEN |
| Q1A-71 | 2B activation stopped at account selector before tamper/replay | FIXTURE_DEFECT | reuse namespaced shared activation fixture; exact replay blocked | OPEN |
| Q1A-72 | 2B activation stopped at account selector before isolation smoke | FIXTURE_DEFECT | reuse namespaced shared activation fixture; exact replay blocked | OPEN |
| Q1A-73 | 2B activation stopped at account selector before privacy audit | FIXTURE_DEFECT | reuse namespaced shared activation fixture; exact replay blocked | OPEN |

No production patch was considered or made. The only corrected root cause
reproduced in R3 was fixture identity reuse.

### R3 results and non-results

Q1A-26, Q1A-27, Q1A-28, Q1A-30, Q1A-31, Q1A-38, Q1A-40, Q1A-41,
Q1A-42, Q1A-43, Q1A-66, Q1A-70, Q1A-71, Q1A-72, and Q1A-73 do not have
R3 exact-package installed PASS receipts. No provider, AI, expiry, IDB,
quota, capacity, transfer, replay, or privacy claim is promoted from the
substitute-package activation probe.

The corrected fixture was validated with real PostgreSQL/API/portal and real
MV3 workers on Chromium 151.0.7922.34 for the bounded activation/transfer
probe. Provider calls and AI sends were zero in that probe. The exact package
worker result remains `NOT_RUN` because its archive is absent.

### R3 authoritative Q1A-01..91 matrix

| ID | final classification | evidence |
|---|---|---|
| Q1A-01 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-02 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-03 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-04 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-05 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-06 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-07 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-08 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-09 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-10 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-11 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-12 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-13 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-14 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-15 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-16 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-17 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-18 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-19 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-20 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-21 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-22 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-23 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-24 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-25 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-26 | TEST_DRIVER_MISSING | no focused installed driver; exact receipt not emitted |
| Q1A-27 | TEST_DRIVER_MISSING | no focused installed driver; exact receipt not emitted |
| Q1A-28 | TEST_DRIVER_MISSING | no focused installed driver; exact receipt not emitted |
| Q1A-29 | INSTALLED_PASS | R2 exact-package materialization |
| Q1A-30 | TEST_DRIVER_MISSING | no focused installed driver; exact receipt not emitted |
| Q1A-31 | TEST_DRIVER_MISSING | no focused installed driver; exact receipt not emitted |
| Q1A-32 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-33 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-34 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-35 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-36 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-37 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-38 | BROWSER_ENVIRONMENT_DEFECT | exact archive absent; fixture correction cannot be counted with another package |
| Q1A-39 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-40 | BROWSER_ENVIRONMENT_DEFECT | exact archive absent; fixture correction cannot be counted with another package |
| Q1A-41 | BROWSER_ENVIRONMENT_DEFECT | exact archive absent; fixture correction cannot be counted with another package |
| Q1A-42 | BROWSER_ENVIRONMENT_DEFECT | exact archive absent; fixture correction cannot be counted with another package |
| Q1A-43 | BROWSER_ENVIRONMENT_DEFECT | exact archive absent; fixture correction cannot be counted with another package |
| Q1A-44 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-45 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-46 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-47 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-48 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-49 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-50 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-51 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-52 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-53 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-54 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-55 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-56 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-57 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-58 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-59 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-60 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-61 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-62 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-63 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-64 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-65 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-66 | BROWSER_ENVIRONMENT_DEFECT | exact archive absent; fixture correction cannot be counted with another package |
| Q1A-67 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-68 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-69 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-70 | HARNESS_DEFECT | source-reopen helper remains unimplemented/hung; no exact receipt |
| Q1A-71 | BROWSER_ENVIRONMENT_DEFECT | exact archive absent; fixture correction cannot be counted with another package |
| Q1A-72 | BROWSER_ENVIRONMENT_DEFECT | exact archive absent; fixture correction cannot be counted with another package |
| Q1A-73 | BROWSER_ENVIRONMENT_DEFECT | exact archive absent; fixture correction cannot be counted with another package |
| Q1A-74 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-75 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-76 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-77 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-78 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-79 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-80 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-81 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-82 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-83 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-84 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-85 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-86 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-87 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-88 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-89 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-90 | INSTALLED_PASS | carried R2 exact-package receipt |
| Q1A-91 | INSTALLED_PASS | carried R2 exact-package receipt |

The carried R2 PASS rows remain valid because they retain their exact package
identity. The R3 OPEN rows are not accepted as Q1-A closure.

### Regression, safety, privacy, and governance

- Fixture-helper Python syntax passed; API-harness formatting was corrected.
  The namespaced activation/transfer probe passed on the substitute generated
  runtime. Full R3 remaining-matrix, representative smoke, A22/A23, beta,
  auth, Core, I1, application, and bridge reruns were not claimable because
  the required exact archive was absent.
- No new safety receipt is claimed. Existing R2 safety remains:
  ordinary Ozon/WB/AI control calls 0; provider UNKNOWN replay 0; known-response
  redispatch 0; delivery UNKNOWN resend 0; confirmed duplicate 0; Health
  heartbeat 0; command-time Bootstrap 0; transfer provider/AI calls 0; backup
  provider/AI calls 0.
- No new privacy receipt is claimed. Existing R2 synthetic-marker evidence
  remains the carried result; R3 found no privacy regression.
- Q1-B browser-family, Q1-C owner/live provider/AI/account, Q1-D
  admin/preprod/release, and Q1-E monitoring consumption remain deferred and
  were not started.
- Remote publication remains
  `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`; no force push, reset, rebase,
  amend, or publication was performed.
- Disk free space was approximately 468 MB at preflight and 477 MB after the
  disposable database was dropped. No broad cleanup was performed.

### R3 disposition

R3 does not recommend architect acceptance. Recommended status remains
`Q1A_PARTIAL_ENVIRONMENT_DEFERRED` with explicit open fixture/test-driver
work, not a product defect. The exact next bounded task is to restore the
required exact archive, add the focused Q1A-26/27/28/30/31/66 drivers, implement
the bounded source close/reopen helper, run the corrected shared activation
fixture for Q1A-38/40/41/42/43/71/72/73, then run the requested regression
matrix and return to architect review. Do not start Q1-B/C/D/E.
## R4 — final-package reconstruction and complete installed closure

Work ID: `Q1-A-R4-20260919-FINAL-PACKAGE-RECONSTRUCTION-AND-COMPLETE-INSTALLED-CLOSURE`.

This is an additive R4 engineering receipt. It does not self-accept Q1-A.
Q1-B, Q1-C, Q1-D, Q1-E, S1.2, deployment, browser-store publication, and
monetization were not started.

### Git, remotes, and safety

- Start HEAD/tree: `6bbc1ad5bffd2d93f621e8da632f4cf295f5db9f` /
  `d4b5467fc2d1899e5dc77bccf4b2f83dd73b81a4`.
- Branch: `feature/q1-a-installed-unified-matrix-2026-09-19`.
- Architect-accepted D3/S2 base: `79893dd1f9f9e54dd9959b8ffdef83f7cf4fc0dd`.
- Verified remote heads:
  - `origin/main` = `bc718cc5c677ad0eb4598e7de3ad766473ff0847`
  - `origin/integration/i1-c1-srv5-2026-09-16` = `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
  - `origin/docs/roadmap-autonomy-correction-2026-09-18` = `6a48af8cd19137aaa10688c36cb064d3c4b16969`
- Production extension/client/server/shared sources were unchanged. Stream-2
  paths `apps/health-runner/**`, `packages/server/health/**`, and
  `tooling/api-watch/**` were not modified.
- Pre-existing untracked package symlinks and `repro/` content were preserved.
  No history rewrite, amend, force push, or remote publication was performed.
- Status remains `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`.

### Disk and environment

- Disk before cleanup: approximately 470 MB available on `/dev/vda1`.
- Removed only named task-owned disposable `/tmp/q1a-*` artifacts and the
  recreatable Playwright headless-shell cache. Canonical Chromium was retained.
- Disk after cleanup/builds: approximately 742 MB available.
- PostgreSQL: `postgres:18.0`, container `d3s2-r1-e2e-postgres`, port
  `55446`; unique databases used included
  `q1a_r4_20260919`, `q1a_r4_installed2_20260919`, and transfer probe DBs.
  Migration completed through 0018; `/health/ready` returned 200.
- Canonical browser:
  `/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  Chromium `151.0.7922.34`. System Chrome 147 was not used as the primary
  acceptance browser.

### Package recovery and final identity

- Exact locations searched: repository `repro/`, repository evidence and build
  paths, `/tmp`, `/var`, and task-owned package/archive locations under
  `/root`; all candidate ZIPs were hashed.
- Exact old `0d23e0e195f42c4ccc7f3492c606cf95129332aef33b6ce90a495a589f9331e8`
  archive: **not found**.
- Prior-document `0166cd246f5b37229caa1f33f284db5c4530892498882c0659e3e6759fcfedc`
  archive: **not found**.
- Extracted old package, package-build manifest, exact historical generated
  configuration input, and generated-prefix receipt: **not found**.
- One deterministic reconstruction attempt was made from the available R1
  receipt/search material; it could not reproduce the historical bytes because
  the generated configuration artifact/input is absent. Exact reconstruction:
  **impossible**.
- Stage B was therefore selected once:
  `Q1A_FINAL_LOCAL_ACCEPTANCE_PACKAGE`.
- Frozen configuration:
  `environment=LOCAL DEVELOPMENT`,
  `controlApiOrigin=http://127.0.0.1:43100`,
  `portalOrigin=http://127.0.0.1:43101`,
  `extensionVersion=0.2.4`,
  `contractVersion=control_plane_v2`,
  trust key id `i1-client-local`, fingerprint
  `5549b9a320d6fcbb344f968e164dce878fc181e2b304831a511410f45da51d89`.
- Final ZIP:
  `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`
  SHA-256 `93ba77f6fcac9932e991c94eded2d9638bb38c9990b8fcefd826d737aaf8d476`;
  size 2,076,757 bytes; 39 runtime files, 39 extracted files, 39 ZIP entries.
- Repeat build SHA and bytes: identical. Source-to-extracted parity: PASS.
  Runtime inventory includes manifest, popup HTML/CSS/JS, service worker and
  entry, content scripts, and the 30 shared runtime files.
- The no-config current-tree package was 2,075,976 bytes,
  `5f023926ce9fb140766b25fdb4dbe104ce5861f4996d2d3f01b5817aeca64b9c`.
  Differential result:
  `PRODUCT_RUNTIME_BYTES_IDENTICAL` after removing only the known generated
  configuration prefix from `service_worker.js`;
  `GENERATED_TEST_CONFIGURATION_DIFFERENT`; no production runtime change.
- Canonical Chromium loaded the exact final runtime. The installed proof
  registered an MV3 worker, loaded the popup, used chrome.storage, and passed
  persistent-profile account reset/restart checks. Observed source-runtime
  worker ID: `adcfiblgfnpegaalkmaedjgkdkgmndff`. The extracted runtime also
  registered a worker and loaded the popup.

### Initial failure batch and R4 disposition

| Scenario | R3 initial result | R4 action/result |
|---|---|---|
| Q1A-26 | TEST_DRIVER_MISSING | No dedicated final-package installed large-JSON driver completed; lower-layer coverage retained. |
| Q1A-27 | TEST_DRIVER_MISSING | Current-package binary gate passed; dedicated installed receipt not completed. |
| Q1A-28 | TEST_DRIVER_MISSING | Current-package opaque/binary gate passed; dedicated installed receipt not completed. |
| Q1A-30 | TEST_DRIVER_MISSING | Installed P2/P3 restart/wake coverage passed; exact result-buffer before/after-expiry receipt not completed. |
| Q1A-31 | TEST_DRIVER_MISSING | Transaction-abort gate passed on current runtime; installed failure-injection receipt not completed. |
| Q1A-38 | FIXTURE_DEFECT | Namespaced activation fixture plus real API/portal/DB completed; INSTALLED_PASS. |
| Q1A-40 | FIXTURE_DEFECT | Namespaced fixture retained; beta installed flow not completed. |
| Q1A-41 | FIXTURE_DEFECT | Namespaced fixture retained; concurrent installed last-slot race not completed. |
| Q1A-42 | FIXTURE_DEFECT | Namespaced fixture retained; capacity-reached installed flow not completed. |
| Q1A-43 | FIXTURE_DEFECT | Namespaced fixture retained; idempotent increment installed flow not completed. |
| Q1A-66 | TEST_DRIVER_MISSING | Two-profile quota driver not completed. |
| Q1A-70 | HARNESS_DEFECT | Instrumented bounded source-close/reopen helper not completed; no historical phase can be isolated. |
| Q1A-71 | FIXTURE_DEFECT | Shared namespaced transfer setup retained; final-package tamper/replay receipt not completed. |
| Q1A-72 | FIXTURE_DEFECT | Shared namespaced transfer setup retained; final-package account/device receipt not completed. |
| Q1A-73 | FIXTURE_DEFECT | Shared namespaced fixture retained; final-package durable-marker scan not completed. |

No assertion exposed a product defect. The transfer runner attempts terminated
without a bounded result receipt; this is recorded as incomplete harness
evidence, not as a TRUE_EXTERNAL_ENVIRONMENT_BLOCKER.

### Completed driver/harness work and results

- Installed harness accepts `SA_Q1A_FINAL_PACKAGE_ROOT`, preventing package
  regeneration between groups.
- Shared fixture namespace remains `SA_I1_FIXTURE_NAMESPACE`; real OTP,
  registration/admission, device authorization, account selection, exchange,
  and Bootstrap were exercised by the successful installed proof.
- Browser authority fixture was made compatible with the frozen trust-key id.
- Binary gate: exact CSV/ZIP/PDF/PNG bytes, SHA/length, opaque refs, one
  provider call, and invalid-magic fail-closed behavior passed against the
  current runtime.
- IDB transaction gate: request-success did not resolve before transaction
  completion; abort published no ref and caused no provider replay.
- Installed P1/P2/P3 source and extracted suites passed. P1 recorded provider
  UNKNOWN with zero automatic replay, known-response restart with zero
  redispatch, 429 with no automatic retry, and report START UNKNOWN with no
  fabricated ID. P2 recorded materialization after restart, zero additional
  provider calls, and delivery UNKNOWN with zero additional sends. P3 recorded
  restart, duplicate wake convergence, zero marketplace requests, and no
  periodic scheduler alarm.
- The existing application lower-layer suite passed 15/15 on the product-
  identical current runtime; it is explicitly not installed live acceptance.
- Large JSON, XLSX-equivalent, opaque original-file delivery, exact expiry
  cleanup, fixture-level IDB abort through the installed result path, the
  two-profile quota coordinator, source close/reopen, beta admission/capacity,
  and final-package transfer security/privacy flows remain without complete
  R4 installed receipts.

### Installed receipts

The following exact-package installed proof is complete:

| Area | Package SHA | Browser | Worker | API | DB | Provider calls | AI sends | Result |
|---|---|---|---|---|---|---:|---:|---|
| Activation/account reset (Q1A-38 boundary) | `93ba77f6…aaf8d476` | Chromium 151.0.7922.34 | yes | yes | yes | 0 | 0 | PASS |
| P1 provider outcome | same | Chromium 151.0.7922.34 | yes | fixture boundary | fixture | 1 initial / 0 automatic replay | 0 | PASS |
| P2 result recovery | same | Chromium 151.0.7922.34 | yes | fixture boundary | fixture | 1 initial / 0 additional | 0 | PASS |
| P3 wake/expiry coordinator | same | Chromium 151.0.7922.34 | yes | fixture boundary | fixture | 0 | 0 | PASS |

Q1A-26/27/28/30/31/40/41/42/43/66/70/71/72/73 are not promoted to
INSTALLED_PASS by these receipts.

### Representative smoke and regression

Representative exact-package smoke evidence is partial: worker/popup and
activation/account isolation passed; P1/P2/P3 passed. The requested complete
Q1A-01/04/08/15/24/32/35/44/49/54/64/74/75/81/84/91 representative set
was not rerun as a complete final-package matrix.

Production source was unchanged, so no production regression is inferred. The
requested R4 regression suites A22/A23 9/9, auth integration, beta admission,
C3E/F/G/H, P1, P2, P3/100-wake, Core, I1, application, and bridge guard were
not all rerun as a complete R4 closure set. Individual P1/P2/P3 and application
checks above are the only new receipts.

### Q1A-01..91 final matrix

Status meanings here are deliberately evidence-oriented: only
`INSTALLED_PASS` means a final-package canonical installed receipt. The
matrix is not an acceptance claim.

| Q1A-01 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-02 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-03 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-04 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-05 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-06 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-07 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-08 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-09 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-10 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-11 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-12 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-13 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-14 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-15 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-16 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-17 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-18 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-19 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-20 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-21 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-22 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-23 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-24 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-25 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-26 | INSTALLED_PASS | R5A exact-package large JSON receipt; 3,200 rows, one provider call, complete result buffer. |
| Q1A-27 | INSTALLED_PASS | R5A exact-package direct PNG/binary receipt; bytes and SHA preserved, one provider call. |
| Q1A-28 | INSTALLED_PASS | R5A exact-package opaque PDF receipt; bytes and SHA preserved, one provider call. |
| Q1A-29 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-30 | INSTALLED_PASS | R5A exact-package expiry/restart/wake receipt; exact boundary cleanup and zero replay. |
| Q1A-31 | INSTALLED_PASS | R5A exact-package artifact-writer failure receipt; no partial artifact/reference and next operation passes. |
| Q1A-32 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-33 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-34 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-35 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-36 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-37 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-38 | INSTALLED_PASS | final package SHA `93ba77f6fcac9932e991c94eded2d9638bb38c9990b8fcefd826d737aaf8d476`; Chromium 151 real API/DB activation/account isolation receipt. |
| Q1A-39 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-40 | R4_OPEN_DRIVER_OR_FLOW | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-41 | R4_OPEN_DRIVER_OR_FLOW | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-42 | R4_OPEN_DRIVER_OR_FLOW | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-43 | R4_OPEN_DRIVER_OR_FLOW | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-44 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-45 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-46 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-47 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-48 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-49 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-50 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-51 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-52 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-53 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-54 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-55 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-56 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-57 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-58 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-59 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-60 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-61 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-62 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-63 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-64 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-65 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-66 | R4_OPEN_DRIVER_OR_FLOW | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-67 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-68 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-69 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-70 | R4_OPEN_DRIVER_OR_FLOW | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-71 | R4_OPEN_DRIVER_OR_FLOW | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-72 | R4_OPEN_DRIVER_OR_FLOW | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-73 | R4_OPEN_DRIVER_OR_FLOW | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-74 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-75 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-76 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-77 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-78 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-79 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-80 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-81 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-82 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-83 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-84 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-85 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-86 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-87 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-88 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-89 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-90 | R4_NOT_RERUN | final-package installed receipt not established in this bounded pass; see scope below. |
| Q1A-91 | REPRESENTATIVE_SMOKE_BOUNDARY | final-package installed receipt not established in this bounded pass; see scope below. |

### Safety, privacy, governance, and closure

- New receipts observed ordinary Ozon controls 0, ordinary WB controls 0,
  ordinary AI-delivery controls 0, provider UNKNOWN automatic replay 0, known
  response redispatch 0, delivery UNKNOWN resend 0, confirmed duplicate 0,
  ordinary Health heartbeat 0, command-time mandatory Bootstrap 0, transfer
  provider calls 0 in completed installed probes, and backup provider/AI calls
  0. These counts do not replace the missing complete matrix.
- No privacy/storage regression was observed in the completed P1/P2/application
  and binary gates. The Q1A-73 durable PostgreSQL/API/log/tracing marker scan
  was not completed, so durable-storage privacy is not closed for R4.
- Q1-B browser-family, Q1-C owner/live provider/account, Q1-D admin/preprod/
  release, and Q1-E monitoring consumption remain deferred. Owner/live and
  environment-deferred items are not moved into later lanes.
- No TRUE_EXTERNAL_ENVIRONMENT_BLOCKER was established. The open state is
  engineering/test-driver incompleteness plus incomplete bounded transfer
  receipts.

### R4 disposition

Recommended status: `Q1A_REWORK_REQUIRED / ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`.
Do not recommend `Q1A_READY_FOR_ARCHITECT_ACCEPTANCE`.

Exact next task after architect review: finish the bounded R4 drivers and
instrumented source-close/reopen helper on the frozen package, run the
remaining beta/capacity/quota and transfer/privacy rows with fresh task-owned
PostgreSQL databases and persistent Chromium profiles, rerun the complete
representative smoke and required regression set, then return for architect
review. Do not start Q1-B/Q1-C/Q1-D/Q1-E.

## Q1-A-R5A FILE/RESULT INSTALLED CLOSURE

Work ID: `Q1-A-R5A-20260919-FILE-RESULT-INSTALLED-DRIVERS-CLOSURE`

This bounded section closes only Q1A-26, Q1A-27, Q1A-28, Q1A-30, and Q1A-31.
Q1A-40..43, Q1A-66, Q1A-70..73, Q1-B, Q1-C, Q1-D, Q1-E, S1.2, deployment,
publication, and monetization were not started.

Git/package identity:

- Start HEAD/tree: `81a445b0ebc362fb969ce247b4a2aba69e865753` /
  `43f262759772b521dab340930c1c77a02a6c8c5f`.
- Final HEAD/tree are the bounded evidence commit(s) recorded in the terminal
  report; no production package files entered the commit.
- Remote heads verified: `origin/main` `bc718cc5c677ad0eb4598e7de3ad766473ff0847`,
  `origin/integration/i1-c1-srv5-2026-09-16`
  `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`, and
  `origin/docs/roadmap-autonomy-correction-2026-09-18`
  `6a48af8cd19137aaa10688c36cb064d3c4b16969`.
- Package: `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`, SHA-256
  `93ba77f6fcac9932e991c94eded2d9638bb38c9990b8fcefd826d737aaf8d476`,
  2,076,757 bytes, 39 runtime files / 39 extracted files / 39 ZIP entries.
  Chromium worker registered under Playwright Chromium 151.0.7922.34 and the
  popup loaded successfully. Frozen API/Portal/trust identity was unchanged.

Initial five-scenario batch, completed before product edits:

| Scenario | Initial state | Missing boundary | Classification |
|---|---|---|---|
| Q1A-26 | lower-layer result path only | dedicated installed large-JSON driver | `TEST_DRIVER_MISSING` |
| Q1A-27 | lower-layer binary path only | dedicated installed binary/materialization driver | `TEST_DRIVER_MISSING` |
| Q1A-28 | lower-layer opaque-file path only | dedicated installed original-file driver | `TEST_DRIVER_MISSING` |
| Q1A-30 | P2/P3 primitives only | dedicated installed expiry/restart/wake receipt | `TEST_DRIVER_MISSING` |
| Q1A-31 | lower-layer abort helper only | dedicated installed persistence-failure injection | `TEST_DRIVER_MISSING` |

Installed harness design:

`tests/regression/extension-core/client-i1/q1a_r5a_installed.py` provides one
shared driver around the existing real Chromium `BrowserFixture`: exact ZIP
extraction, worker/popup proof, synthetic provider fetch at the production
adapter boundary, real worker command routing, chrome.storage/IDB readback,
attachment delivery, fake-clock advancement, worker restart, and the accepted
direct-binary `artifactWriter` failure seam. Evidence contains only hashes,
sizes, safe IDs, phases, and counters. No production files or package
inventory were changed.

Installed receipts:

- Q1A-26: `INSTALLED_PASS`; 3,200 objects/rows; input 257,501 bytes,
  SHA-256 `56b4e81529935e026c0434b4994a8e5c189f9186e940654b06e237c83054b569`;
  output 257,501 bytes, SHA-256
  `c4a10d559eeee40501e64d5b9ca0f874ba7fb97674d60b18c0706a3092c00cf7`;
  semantic count preserved, provider calls 1, AI sends 0.
- Q1A-27: `INSTALLED_PASS`; PNG; input/output 95 bytes; SHA-256
  `14c8368e1c2e5fe9e0c1c0af9363108d8bd761a63efe0eb4079d6e010e9b8610` on
  both sides; filename `ozon-return_giveout_get_png-*.png`, MIME
  `image/png`, provider calls 1, one AI send and no duplicate.
- Q1A-28: `INSTALLED_PASS`; opaque PDF; input/output 139 bytes; SHA-256
  `ceeb94ee3431209090201342047916b253db7bd2d3102056be88430f64546ad7` on
  both sides; filename `ozon-posting_fbs_act_get_pdf-*.pdf`, MIME
  `application/pdf`, provider calls 1, one AI send and no duplicate.
- Q1A-30: `INSTALLED_PASS`; phases were
  `RESULT_CREATED -> RESULT_COMMITTED -> PRE_EXPIRY_READ_PASS ->
  WORKER_RESTARTED -> PRE_EXPIRY_AFTER_RESTART_PASS ->
  CLOCK_ADVANCED_TO_BOUNDARY -> EXPIRY_WAKE_TRIGGERED ->
  POST_EXPIRY_READ_DENIED -> CLEANUP_CONFIRMED`; exact `expiry <= now`
  boundary, provider delta 0, AI-send delta 0, and no periodic scheduler
  heartbeat.
- Q1A-31: `INSTALLED_PASS`; accepted direct-binary artifact-writer seam
  rejected the real artifact persistence write before commit; no artifact,
  no valid result reference, no false success, provider replay 0, AI resend 0,
  and the unrelated next Seller operation passed.

Representative regression:

- P1 provider UNKNOWN/no-replay and known-response fencing: PASS on source and
  extracted runtimes; no automatic provider replay.
- P2 known-result recovery: PASS through the focused Q1A-30 restart/read path;
  the older full P2 helper still has its pre-existing final delivery-phase
  assertion mismatch and was not treated as a product defect.
- P3 wake/restart/duplicate wake: PASS on source and extracted; periodic alarms
  0 and marketplace requests 0.
- Extension Core/C1 installed acceptance: C1 36/36 PASS on source and
  extracted. A24 export/import: PASS on both. Application fixture: PASS on
  Chromium 151 with the frozen trust key. The standalone `extension_core.py`
  gate remains environment-deferred because its required
  `dist-step7-candidate/shared/direct_binary_file_delivery_patch.js` artifact
  is absent; no product failure was inferred. The auxiliary C3H lower-layer
  harness likewise remains deferred at its obsolete `AUTH_REQUIRED` setup.

Safety/privacy/governance:

- Ordinary Ozon mandatory control calls 0; ordinary WB mandatory control calls
  0; ordinary AI-delivery mandatory control calls 0; provider UNKNOWN replay 0;
  known-response redispatch 0; delivery UNKNOWN resend 0; confirmed duplicate
  delivery 0; ordinary Health heartbeat 0; command-time Bootstrap 0.
- Q1A-26/27/28 provider calls were exactly 1; Q1A-30 post-expiry provider
  delta 0; Q1A-31 provider replay 0.
- Synthetic payloads only. Large JSON, binary bytes, reports, and AI content
  were not stored in evidence. No new server raw-report persistence was
  introduced; application/C1 privacy checks remained green.
- Stream-2 implementation/evidence paths were not modified. Remote publication
  is `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`; no force push, rebase, reset,
  amend, or destructive cleanup was used.

R5A closure: Q1A-26, Q1A-27, Q1A-28, Q1A-30, and Q1A-31 are completely closed
as installed passes on SHA `93ba77f6…`. No genuine product defect appeared.
This does not self-accept Q1-A. Exact next task: `Q1-A-R5B — INSTALLED BETA /
CAPACITY / SECOND-INSTALLATION QUOTA CLOSURE`, covering Q1A-40/41/42/43/66.

## Q1-A-R5B BETA/CAPACITY/SECOND-INSTALLATION-QUOTA CLOSURE

Work ID: `Q1-A-R5B-20260919-INSTALLED-BETA-CAPACITY-AND-SECOND-INSTALLATION-QUOTA-CLOSURE`

This bounded execution used the existing real namespaced OTP/admission/device
activation fixture and the frozen local acceptance package only. It did not
reopen Q1A-26/27/28/30/31 or start Q1A-70/71/72/73, Q1-B/Q1-C/Q1-D/Q1-E,
S1.2, publication, monetization, or production deployment.

The exact package was rebuilt only because the archive was absent:
`SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`, SHA-256
`93ba77f6fcac9932e991c94eded2d9638bb38c9990b8fcefd826d737aaf8d476`,
2,076,757 bytes, with 39 runtime files, 39 extracted files, and 39 ZIP
entries. The frozen API/portal origins, `i1-client-local` trust key and
Chromium 151.0.7922.34 were unchanged.

Initial driver lookup, before task-owned harness edits, classified all five
rows as `TEST_DRIVER_MISSING`: the dedicated R5B installed beta/capacity and
two-profile quota drivers did not exist. During harness execution, two further
driver defects were corrected: the supervised API needed the frozen signing
key explicitly, and the beta admin helper needed a CommonJS-compatible async
entrypoint. Neither was a product change.

The clean fixture migrated through 0018 on task-owned PostgreSQL 18 at port
55446. Namespaced synthetic identities used `SA_I1_FIXTURE_NAMESPACE`; no
real email, bearer token, storage state, owner credential, marketplace secret,
or raw provider credential was persisted in evidence. The API readiness and
portal activation boundary were reached, and the Q1A-40..43 real admission,
capacity race, existing-account capacity behavior, and idempotent capacity
increment driver reached its focused assertions on the exact package. The
capacity race used one remaining slot and two concurrent OTP verification
requests; the winner/loser retry path reused the original challenge and
idempotency identity. The increment used request identity
`q1a-r5b-43-capacity-increment` and the duplicate was checked as a replay.

Q1A-66 was not accepted in this bounded run. The focused two-profile provider
seam did prove independent Chromium profiles, provider status receipts, and
zero Seller Agents control calls, but it did not complete the required
second-dispatch/429 receipt on the final exact-package run; therefore no
`INSTALLED_PASS` is recorded for Q1A-66 and no Q1A-66 table status is changed.
The standalone P1 receipt remained green on source and extracted exact-package
runtimes, including UNKNOWN no-replay and known 429/Retry-After behavior;
this is regression evidence, not a substitute for the required R5B Q1A-66
closure.

Safety receipt from the focused quota/P1 runs: central quota lease requests 0,
mandatory ordinary provider-dispatch control calls 0, provider UNKNOWN replay
0, known-response redispatch 0, delivery UNKNOWN resend 0, and ordinary
health heartbeat/command-time Bootstrap 0. Stream-2 implementation and
evidence paths were untouched. Remote publication remains
`ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`; this section does not self-accept
Q1-A.

R5B result: Q1A-40..43 have focused real-flow evidence in the task harness,
but Q1A-66 remains open pending a complete installed two-profile receipt.
The exact next task is to finish this same bounded R5B lane, specifically the
Q1A-66 second-installation quota receipt and its Q1A-63..65 focused regression;
R5C must not start until R5B is genuinely complete.
