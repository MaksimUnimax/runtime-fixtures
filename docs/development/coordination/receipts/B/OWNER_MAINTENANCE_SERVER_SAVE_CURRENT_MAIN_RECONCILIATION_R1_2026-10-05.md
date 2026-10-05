# OWNER maintenance server-save current-main reconciliation R1

Recorded: `2026-10-05T15:25:54.985323+00:00`
Fresh base: `cd5e80544fd4ef941e270b549c8a82db5a8d2133` / tree `5ea4f4a0404b68c9a726b58af0c5388e9094fc11`
Historical published source: `7872fc2d51f6b3e8178fe48bb445f47c31204656` / tree `303d5b469e7c8c88e0188ef33d1fc1591c0d93e9`

## Result

PASS_SOURCE_CONTINUITY_PENDING_PUBLICATION. The already-published, installed, and scoped-machine-read-verified maintenance server-save result is an ancestor of fresh main, and every one of its 13 original task paths is blob-identical. This successor changes no product/runtime/admin behavior and performs no live action; it exists only to restore immutable completion accounting after the historical publication cleanup became unusable once later accepted commits advanced `main`.

## Historical acceptance

- Historical task: `OWNER-MAINTENANCE-SERVER-SAVE-20261004`, preserved as BLOCKED with lifecycle evidence.
- Published candidate: `7872fc2d51f6b3e8178fe48bb445f47c31204656`.
- Publication registration: `a0dd2a0c187fe820792d3666a6c25f26503f31622347bb051d0b46b90ec3d531`; historical state remains `PUBLISHED` because its cleanup precondition requires remote main to still equal the old candidate.
- Independent exact-candidate review: PASS: `/root/octoport-control/logs/controller/maintenance-server-save-20261004/R2/PUBLICATION_REVIEW_BOUND.json`.
- Exact five required workflows: PASS: `/root/octoport-control/controllers/task-publication/ready/a0dd2a0c187fe820792d3666a6c25f26503f31622347bb051d0b46b90ec3d531/5.json`.
- Main publication/readback: PASS: `/root/octoport-control/logs/controller/maintenance-server-save-20261004/R2/MAIN_READBACK.json`.
- Installed API/admin release: source `7872fc2...`; public health/admin-login healthy; unauthenticated grant access rejected: `/root/octoport-control/logs/controller/maintenance-server-save-20261004/R2/INSTALLED.json`.
- Owner-authorized credential persistence and one bounded scoped GET were later verified; credential file mode was `0600`, result `VERIFIED_SCOPED_MACHINE_READ`: `/root/octoport-control/logs/controller/maintenance-activation-20261005.json`.

## Current-main continuity

`git merge-base --is-ancestor 7872fc2d51f6b3e8178fe48bb445f47c31204656 cd5e80544fd4ef941e270b549c8a82db5a8d2133`: PASS.

Exact blob identities (historical == fresh main):

- `apps/api/src/maintenance-credential-file.ts` → `d266057c23ee6774002701cf3faa2ec87ca4a7e3`
- `apps/api/src/maintenance-credential-file.test.ts` → `0af19d5dae635c401b88432c5bd2d605f299c471`
- `apps/api/src/maintenance-access-routes.ts` → `365de16600daaae6249afd142e6835975b0441c2`
- `apps/api/src/maintenance-access-routes.test.ts` → `4095350fc675229497db74bfe6e89b0a2b39942d`
- `apps/api/src/admin-auth-routes.ts` → `55ff15c5ff177c5c601d7a894bccc516e0970afd`
- `apps/api/src/app.ts` → `cb75d88743d700439685420c4660f7426700c605`
- `apps/api/src/main.ts` → `aeab95fcad63b4952db35f2de9173f69dd3454f5`
- `apps/admin/app/service-access/access-panel.tsx` → `398812d0eecae1d4a44cfdc06c63a0d8c4456f3e`
- `apps/admin/app/service-access/page.tsx` → `d505be3abb7a3973ecb67ee48b5a4d71f9c1033e`
- `packages/contracts/openapi/openapi.json` → `56419fe6dfccfc10f76f4bb7f4351fe0c2484116`
- `docs/development/MAINTENANCE_ACCESS.md` → `94f6923b0a6b26ac641abc66b9d01214dca35c2e`
- `infra/production/systemd/seller-agents-owner-test-maintenance-storage.conf.in` → `837672b599d3a63c60317422fd758275560b1d8d`
- `tests/integration/server/p5-7-p5-final-acceptance.integration.test.ts` → `d86d7880bc1729d0cffa472d9a59ce914c53f828`

## Accounting-only blocker

The old registration reached `PUBLISHED`, but its `cleanup-ref` implementation requires remote `main` to equal the registered candidate before deleting the temporary task ref. Later accepted commits advanced `main`, so the historical route fails closed with `CLEANUP_MAIN_READBACK_DRIFT` even though the published candidate remains an ancestor and its full 13-path source slice is unchanged.

No registration, board row, receipt, or remote ref is manually edited to erase that history. This one-file same-plan successor is the immutable accounting path: independent review on this exact candidate, five exact-head CI workflows, non-force publication/readback, strict successor DONE, then `queue-resolve-blocker` for the historical row using the successor completion receipt.

## Non-claims

- No credential is issued, rotated, read, copied, or exposed by this reconciliation.
- No new maintenance GET, service restart, DB operation, API/admin/OpenAPI/systemd/runtime mutation, browser/provider action, deployment, or production change is performed.
- Historical installed/scoped-machine-read evidence is carried only as already-recorded evidence; it is not rerun or broadened.
- If any of the 13 original task blobs changes before publication, this continuity result is stale and must be recomputed.
