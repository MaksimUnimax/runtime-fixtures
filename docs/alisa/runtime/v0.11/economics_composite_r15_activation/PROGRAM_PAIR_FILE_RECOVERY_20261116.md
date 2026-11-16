# WB97 activation pairing and unit-file recovery — source checkpoint

16 November 2026. This is a reviewed source checkpoint, NOT a deployable paired installer. The real service-control/admission-fence adapter is still unfinished and the new file transaction is not invoked by the production CLI. Do not install this source checkpoint on Alisa as a completed broker rollout.

## Exact product and package binding

Product cafb743c94672104d4afa2c471398e5c81d904f5 (PR453) passed Source CI43829415700 and Documentation CI43829415597, all9 jobs and all published steps on that exact head. This is separate from the current activation branch's CI.

Actual Alisa PLAN: 733a2d1ded5702f4233524263946a41e14bf26428f8adc7519d4ab5432501616;97 inputs; source index7342caa174709952744104dd156e38441c0caf15a01bc7442043dca100623562. A real complete three-role BUILD and separate full VERIFY succeeded. PREPARED from actual BUILD stdout:4b8d7a3bdaadd6846acf4429fcba6d2809d2f4500df533fd9fd926e8ed041063. No application was switched. The old ca15 PLAN became historical after the independently installed WB change and its failed pre-staging BUILD is retained.

Current activation PRODUCT/PLAN/SOURCE_INDEX and five builder hashes are bound to those externally measured values, not computed from an unqualified input merely to pass. The CLI attempt prefix follows the pinned product commit. Five executable tool files are externally hashed before bootstrap, including program_pair.py. The actual privileged CI gate copy lists include that fifth dependency; no runtime assertion or workflow was removed.

## Implemented safety boundaries

The existing R15 observer now requires the canonical consumer, full immutable program package, exact unit definitions, effective broker and cleanup commands and original socket identity. It checks two stable samples and rechecks before a new native start. No provider request, owner result payload or private DB is read by this pairing observer.

The broker phase core requires a successfully established and confirmed admission fence before rollback eligibility. A failed/partial fence does not trigger automatic restore. A potentially durable admission marker, including uncertain marker fsync failure, prohibits automatic downgrade.

ProgramPairUnitTransaction implements real temporary-file-tested backup, source-identity checks, staged publication and independent restoration of the two exact unit files. Old/ours/retained-original states are explicit; a later writer is not deliberately overwritten. Existing uncertain attempts are not reused, and crash auto-resume is not provided. Result-store content is outside this transaction.

ProgramPairExclusion owns both EXISTING rollout and program-executor kernel flocks. It does not create or chmod a lockfile. Held/public/dirfd identities and actual /proc/self/fdinfo WRITE flock ownership are checked. Explicit unlock is rejected without silent reacquisition. Every mutating transaction operation holds an RLock-protected lifetime pin; callback exit fails, concurrent-thread exit waits, and a transaction becomes unusable after exit. All descriptor cleanup remains finite.

The project deployment mutex is advisory. This does not claim kernel source-inode CAS or protection from a privileged writer deliberately bypassing the project protocol. The real admission fence remains required and must be qualified independently before live use.

## Actual tests and reviews

Final local activation discovery: **183 test methods PASS, zero errors/failures/skips**. This includes the previous activation/readiness/credential/selector/version tests,28 pair/phase/dependency methods,19 real-file/flock/process/thread methods and fifth-tool pre-execution tamper checks. Earlier subset/run counts overlap and must not be summed. Fake systemd/authority observers remain test fixtures; the new real file tests do not prove actual installed admission fencing or PostgreSQL integration.

Reviewer findings were retained and acted on: initial partial-fence rollback eligibility; unchecked cooperating-writer serialization; exclusion lifetime released within callbacks or another thread. Corresponding regressions and fixes are in the final source. Independent gpt-6-luna review R3 approved the LIMITED file transaction/lifetime/pin scope. A separate independent review approved only appending the fifth tool to three privileged gate copy closures. Reviewer source inputs remained unchanged. No live rollout approval was inferred.

INTEGRATED_ACTIVATION_R4 stdout SHA256:5c61e601872855ed1b763e2662d82226e137b3327cb61f1f785b5d16143854e6; stderr SHA256:5ba057aa30fc3cb5810eaa832b0e1f99e616870ed58acf6c663772fd1b451e36. Five-file tool pin:3d56be9d3db76727415fc55ad91d530c47e0f6fc7c1a249695747e70ca665f13.

The full activation unit run previously found an old assertion expecting96 real source inputs; only that expected count was changed to97 while exact source-index and encoding assertions stayed in force. The original four-tool privileged copy lists were corrected to five, with an AST-only exact-closure regression. Earlier failed results remain stored; they are not relabeled success.

Evidence is retained on Easyscript under /root/alisa-r15-paired-activation-source-20261116/: INTEGRATED_ACTIVATION_R1-R4.json and logs; PROGRAM_FILES_R1-R4.json; FILEOPS_REVIEW_R1-R3.txt with intents/results; GATE_CLOSURE_REVIEW_R1.txt and result. Unit processes/cgroups completed. Authorization files were not copied.

## My remaining implementation work

Implement and qualify the real broker adapter: atomically publish the pinned immutable program release; establish and confirm actual socket plus cleanup admission fencing; retain both exclusion locks; prove zero live broker/cleanup instances without cancelling work; reload and verify the two unit definitions; restore before admission only with current-source/ownership checks; preserve retained results; run installed synthetic v2/v3 checks before enabling the R15 consumer. The transaction and phase core in this checkpoint are components of that work, not its completion. Exact-head Activation CI is a separate qualification after publication.

External prerequisites apply only to the dependent live transition: proven individual outcomes for four historical UNKNOWN operations, actual readiness and a fresh coordination window immediately before APPLY. No UNKNOWN replay/clear, owner DB/credential/coefficients change or application restart occurred here. Source/package/InstalledSynthetic/LiveOwner remain distinct.

## Exact tested hashes

- `activate.py`: `b216b6b9f8df1e9196a5ce247a4581d82c42729aefbd4011b3a8b555ee3eb0f2`
- `activation_contract.py`: `042d0c5fd083e28c005f4bd522978b7060099284b329a2e324900f6693605b34`
- `program_pair.py`: `67c2a6fb965e3e5c76c54ed14ea881e6202f9e90e2ed5802a68453792941d149`
- `readiness.py`: `ce3cf08c8338f8d34d07c222b2c974b867098f185bfba165b5a4526f77853658`
- `runtime_versions_sync.py`: `10421a4ec0000a5e26ecc92e5fbeed0a31f48133698a84b92935b04700615dd4`
- `tests/native_credential_gate.py`: `bc3cb1d0220d52f3961128fde880789353326af57502b4810a31bddfc27b7347`
- `tests/private_probe_gate.py`: `8448395d2aaf9bc2e90885031d98a079e32716caa4ed67f6b69d11e12207c828`
- `tests/selector_consumer_gate.py`: `a817aca8e60831133ec434026aeaedb26f02010937f3b3b774aa2b44390fbdcd`
- `tests/test_activation.py`: `a3edcc75f68026f4e274fc0a0a8a31851151a06052459463988a48e4f9d11a11`
- `tests/test_program_pair.py`: `3e812c1a7d768d08483c310244fa7343963cc543a75690ed56f0c352d80ae945`
- `tests/test_program_unit_files.py`: `16958ee1c8cecde2721a8a7b0bd958e5cf4f9b476fe747c809702d45594faf4e`
- `tests/test_version_probe.py`: `97846234016eb2d03f4638db33b970f6d9e066cb4744f260ed55840ac3f84c68`
