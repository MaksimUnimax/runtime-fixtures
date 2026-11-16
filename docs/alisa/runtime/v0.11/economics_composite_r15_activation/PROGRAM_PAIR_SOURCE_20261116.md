# Program pairing — reviewed source checkpoint, not a deployable R15 release

Date: 16 November 2026. Parent source: ca15c4d2ebc98414d60e114c4c657b89cb3f5cbd.

## Implemented scope

The R15 tool now includes `program_pair.py` in the externally hashed bootstrap closure. The real read-only observer verifies the exact broker, Worker, Results, Harness patch, manifests and retained test file; the canonical client hash; all three unit source files; effective broker and cleanup commands; and the existing socket identity and state. Two complete observations must agree. Writable files, symlinks, hardlinked payloads, extra bytecode, pending daemon reload, drop-ins, old loaded commands and a changed endpoint are refused. No owner result payload, private database or broker request is read or sent.

The observation is part of `LiveHost.capture`, is compared by `protected`, and is checked again before validating a new native start. A compatible producer must already be installed and qualified before a new consumer can be enabled.

`rollout_pair` is a finite phase-ordering core ONLY. It has no live mutation adapter and the production CLI does not invoke it. A verified admission fence and held locks precede publication/switching. Failed or partial fencing never enters automatic rollback. A marker write/fsync with uncertain outcome and any post-marker error require reviewed recovery, not automatic downgrade. The future adapter still needs real filesystem CAS, retained-result preservation and actual-systemd qualification.

## Evidence

Final targeted run: 36 test methods PASS, zero failures/errors/skips: 27 pairing/phase/integration methods and 9 unchanged R15 phase-fault methods. Disposable files, simulated unit observations and a fake phase adapter were used; external/provider calls were disabled. This is not full Activation CI, installed synthetic qualification or owner acceptance. The earlier 26/35-method results overlap this final set and must not be added to it.

Independent gpt-6-luna source review R1 requested changes: rollback eligibility had been set before fencing succeeded. The newly added regression failed against that source. The fix moves eligibility after both the fencing operation and explicit fence confirmation. R2 independently approved the LIMITED source scope, explicitly excluding live-adapter safety. Both review units completed, were collected, and left the reviewed source unchanged.

Operational evidence on Easyscript is under `/root/alisa-r15-paired-activation-source-20261116/`: REGRESSION_R2.json, regression-r2.stdout/stderr, REVIEW_R1/R2.txt and result/intent files, plus fence-before-fix.stderr. No authorization files were copied. Source pins:

- `activate.py`: `94a2532a746227cbf2938d0fa621affeaf21d0a68e4959097a73a8efd0b00ebf`
- `activation_contract.py`: `d79cda87827511f168cff4c0d91d50e2f724e07005f48f366abbb912ef7ade32`
- `program_pair.py`: `67c2a6fb965e3e5c76c54ed14ea881e6202f9e90e2ed5802a68453792941d149`
- `tests/test_program_pair.py`: `5b7ff7e3143c9a814b8be4386d03c5b9667602557c6fc1b98072bc7980efd718`

## Concurrent installed-base change — independently observed, not silently accepted

A full 97-input BUILD was attempted once on Alisa after resource/input verification. It stopped in the initial base snapshot with `LIVE_POINTER_CHANGED:native`, before staging or candidate creation. Actual return code was 1; a collected systemd unit's default Result/ExecMainStatus must not be substituted for that command failure. Existing PLAN fbb310835a9d3dea42c21c89e9c6f0014a39150b8554893ee92567fddb20db02 is now historical and must not be rerun against the changed live base.

The parallel WB rollout installed source e0a10bb47fe1cd83bbc4aaa47fa1f05ae3a4b725. Native manifest: fa078b54e2bf1b57ae3c55e7ffba2a832367a17755a9c24eeedf7bc0d70ddb29. WEB manifest: 3fd0a1d22b68678918102b5072b0bd6118481d153436569da66a09a7ca43e534. Both roots are named alisa-wb-activity-e0a10bb47fe1cd83 in their respective release parents. WEB .venv points through the retained units release to the existing enrollment environment. The APPLIED receipt SHA256 is 4fd28f3fa8986224ec2f5e74992e091fa21efbb18a1aadb86f05b3f9dd15ae28. The separate LIVE_BROWSER receipt reports LIVE_BROWSER_PASS; it is WB acceptance, not R15 acceptance.

Both native manifests contain 184 files. Exactly base_blocks.json and template_catalog.json differ; the other 182 manifest hashes are unchanged. Current R8 BASELINE.json still pins the previous template_catalog.json, and prepare verifies that pin. A bare repin of the top-level builder baseline therefore would not be sufficient and must not be used as a workaround. The WB metadata must be preserved and the R8/builder compatibility boundary independently tested.

## Deliberately unfinished — next responsibilities

MY next source work: support and prove the installed WB metadata variant without undoing its B14 period fix; then obtain a newly qualified baseline and PLAN. MY installer work: implement the real finite broker mutation/rollback adapter, test actual CAS/fencing/recovery behavior, and complete the 97-input activation contract and full CI qualification. Those tasks do not wait for a tester reply.

The old PRODUCT/PRODUCT_PLAN/SOURCE_INDEX and builder pins are intentionally unchanged in this checkpoint. Therefore it is NOT a qualified 97-input installer, and no full-source CI success is claimed. No workflow was weakened or added. Do not deploy this checkpoint or the historical 96-input installer with the new candidate.

External prerequisites apply only to the later live transition: primary individual outcomes of the four historical UNKNOWN jobs and a fresh coordination window immediately before APPLY. No UNKNOWN status was changed or replayed. R15 BUILD completion, broker deployment, R15 APPLY, InstalledSynthetic and LiveOwner remain NOT_RUN.
