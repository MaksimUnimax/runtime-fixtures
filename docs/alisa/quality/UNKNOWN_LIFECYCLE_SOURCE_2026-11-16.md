# UNKNOWN lifecycle: bounded source qualification, 16 November 2026

## Status and scope

**Corrected source qualification R2: PASS, seven of seven cases.**
The earlier R1 assertion failure is retained below as a separate observation.
This adds one standalone qualification script and this document. It adds no
runtime implementation. This qualifier does not execute the full acceptance
cases **AL-N16-03** or **AL-T08-03**. Its receipt records that execution boundary
as **NOT_RUN**, without changing the maintained roadmap status. Existing
**PARTIAL** evidence for AL-T08-03 remains valid and unchanged. An approved
execution writes a separate JSON
receipt; its actual result must accompany any subsequent source qualification
claim.

The script qualifies exact native source identities against a synthetic
provider/authority/clock and disposable SQLite databases. It tests persistence,
the existing acceptance identity, cancellation/clarification refusal, retention,
lease recovery, and independent queue progress. It neither reads nor changes
the installed runtime or business databases.

Base source: `MaksimUnimax/runtime-fixtures` at
`a4f9746191db765b6498acede3764db5225b3a22`.
This identifies pinned fixture inputs, not the later commit of this new script.
The generated receipt records the script SHA256 separately.

New files:

- `products/alisa/tests/runtime_authority/unknown_lifecycle.py`
- `docs/alisa/quality/UNKNOWN_LIFECYCLE_SOURCE_2026-11-16.md`

The existing product, runtime adapter, staff RBAC, routes, activation state
machine, fixture builder, suite routing, and CI workflows are unchanged.
In particular, PR435/PR436 source remains frozen, and PR437's web catalogue
period work is outside this change.

## Approved requirements and incomplete product boundary

These are exact entries from
`docs/alisa/service-platform/v0.5/data/acceptance.json` at the pinned base:

Their NOT_RUN fields belong to that normative snapshot. The separate published
PR437 branch record `docs/alisa/quality/ROADMAP_ACCEPTANCE_2026-11-15.md`, at
`dea0498f51980cdc72411468d2fa8709da7d69c9` (blob
`0996b5a91d93d4e100b7aff6fba7bc3bbd1f1dce`), records AL-T08-03 as PARTIAL.
This qualification neither edits that record nor discards its existing evidence.

```json
{
  "id": "AL-N16-03",
  "feature_id": "AL-F20",
  "execution_step": "AL-S16",
  "title": "Неизвестный исход marketplace не повторяется",
  "category": "SEQUENCE_ACCEPTANCE",
  "preconditions": "Есть UNKNOWN реального по структуре, но синтетического transport-ответа.",
  "steps": [
    "Открыть инцидент и допустимую сверку.",
    "Попробовать force retry без доказательства."
  ],
  "expected": [
    "Повтор запрещён; источник неопределённости виден оператору.",
    "Никакая кнопка не превращает UNKNOWN в READY."
  ],
  "status": "NOT_RUN",
  "required_evidence": [
    "точная сборка и адрес",
    "действия и наблюдаемый интерфейс",
    "безопасные счётчики/фактический результат",
    "подтверждение отсутствия утечки/побочного эффекта"
  ],
  "actual": null,
  "origin": "NEW_V0.3_SEQUENCE_CASE",
  "requires_capabilities": [
    "job_view",
    "durable_job_recovery",
    "gap_ingest",
    "gap_clusters",
    "support_workflow",
    "account_deletion",
    "admin_audit",
    "ops_health",
    "incident_management",
    "fair_queue_evidence",
    "product_statistics",
    "safe_stats_export",
    "runtime_budget_controls"
  ]
}
```

```json
{
  "id": "AL-T08-03",
  "feature_id": "AL-F08",
  "category": "UNKNOWN",
  "preconditions": "Transport отправил запрос, но исход неизвестен.",
  "steps": [
    "Потерять ответ в killpoint",
    "перезапустить",
    "открыть диагностику",
    "вызвать обычный retry."
  ],
  "expected": [
    "Состояние UNKNOWN",
    "нет слепого повтора",
    "оператор видит причину и допустимый путь сверки",
    "нельзя одним флагом переименовать в успех."
  ],
  "status": "NOT_RUN",
  "required_evidence": [
    "точный commit и artifact hash",
    "среда, версия БД/каталога и fixture ID",
    "фактические значения и отрицательные проверки",
    "безопасный журнал/скриншот без секретов"
  ],
  "actual": null,
  "execution_step": "AL-S10",
  "origin": "PRESERVED_V0.2_CASE",
  "requires_capabilities": [
    "job_submission",
    "result_view",
    "basic_ttl",
    "basic_no_replay",
    "runtime_access_fence",
    "inflight_store_revision",
    "durable_job_recovery",
    "source_wait_ui",
    "unknown_handling",
    "full_cancel",
    "cross_channel_ttl",
    "execution_expiry_policy"
  ],
  "chronology_note": "Продуктовый тест не исполнен; потребуется пригодная сборка на указанном шаге."
}
```

The roadmap entry AL-S16 in
`docs/alisa/service-platform/v0.5/data/roadmap.json` is titled
**«Оператор видит пользователей, качество и реальные сбои»**. Its implementation
path is `products/alisa/services/platform/src/alisa_platform/operations/`.
Its required steps are AL-S03, AL-S07, AL-S08, AL-S10, AL-S12, AL-S14 and AL-S15.

`WORK_PROTOCOL.md` §2 requires all necessary layers and actual effect for a
completed feature; an API without its screen is insufficient. Section 7 permits
independent changes with known inputs, without accepting future functionality
before its dependencies. This qualification is such an independent source
result. It does not close AL-S16.

There is an explicit proposed operator contract:
`docs/alisa/service-platform/v0.5/api/openapi.yaml`,
`POST /staff/api/v1/operations/reconciliations`, operationId
`reconcileUnknown`, permission `ops.reconcile`, staff session, CSRF and
Idempotency-Key. `ReconcileRequest.kind` includes `RUNTIME_UNKNOWN`.
A 202 ActionReceipt is acceptance of an action, not proof of its actual effect.

The pinned platform route list in
`products/alisa/services/platform/src/alisa_platform/config/urls.py`,
closed actions in `staff/views.py`, and permissions in `staff/policy.py`
do not implement that operation. The pinned complete repository tree has no
`operations/` package. Even OWNER's present permission set does not contain
`ops.reconcile`. These are source observations; no live endpoint was probed.
This work supplies neither missing authorization nor a substitute through
`audit.read`, an unrestricted staff command, or direct database updates.

## Reproducible fixture inputs

Run from a checkout containing the two new files and the exact inputs below.
No network fetch occurs inside the qualifier, and no scratch-specific absolute
path is embedded in it. Missing or different inputs fail before product imports.

The existing archive is
`products/alisa/tests/current_parameters/native_fixture/qualified_core_source.tar.gz`:

| Property | Pinned value |
| --- | --- |
| Archive bytes | 707221 |
| Archive SHA256 | `d1b5a3e0a18749c45025c56c7c74fe32bdb979d788e10f2d416ebd35bd311309` |
| Git blob | `6b887696ea61294e1b7a114c5a06d5d0d85e5bfb` |
| Archive members | 176 regular files, exact inventory and per-file hashes |
| Manifest SHA256 | `44e238b9a03fe5351fabd5a3afe030a53af5d3edf7225f0795478681b2948c55` |

The qualifier uses the archive's existing manifest validation approach, followed
by only the existing `current_parameters_r4/prepare_candidate.py` and
`current_parameters_r5/prepare_candidate.py`. It checks their source, baseline,
candidate, runtime leaf, and platform input hashes before executing the overlay
code. Every generated R4/R5 candidate hash and the complete final inventory
must match before importing the native product.

It deliberately does not invoke the full existing
`products/alisa/tests/current_parameters/build_native_fixture.py`: that entrypoint
also applies R8/R11/R13/R14/R15, whereas the source under investigation is the
currently installed R4/R5-derived runtime. No existing builder is edited.

The four R4 parameter support files are already present at the pinned base:

- `products/alisa/services/platform/src/alisa_platform/owner_data/parameter_catalog.json`
- `products/alisa/services/platform/src/alisa_platform/owner_data/parameter_contract.py`
- `products/alisa/services/platform/src/alisa_platform/owner_data/parameter_producers.json`
- `products/alisa/services/platform/src/alisa_platform/owner_data/parameter_producers.py`

Their Git blobs were also read at historical R4 commit
`bcb41791658988b7fc7fad835495ed4cdf6be59f` and are identical to the pinned base.
The R4 candidate SHA256 values are enforced in the script. Thus no hidden
historical input directory or extra source copy is required by the public CLI.

Thirteen input files plus the archive have literal SHA256 pins in
`INPUT_SHA256`/`ARCHIVE_SHA256`. R4/R5 overlay output is checked against the
pinned candidate metadata. The final expected inventory includes all original
archive files and the exact additive files. It is verified again after imports
and at completion. The runtime fixture becomes read-only before product use.

### Fresh comparison with installed source

A separate, metadata-only readback on 2026-11-16 at 01:45:43.684231 UTC verified
these ten files against the installed manifest
`20c5afddbc8f07c86e72a33676d4475c4b23b7c0316bc73f814e51dc5a60e95e`.
Native PID 1417979 and the process/root identity were equal before and after.
This qualifier itself makes no server call.

| Native source file | Required SHA256 |
| --- | --- |
| `repository.py` | `17c510e5ddccc8deca022d30b9fef814d83af950a4ef2d791fab13b795805404` |
| `engine.py` | `da352a4024dda12c4e7a808f94718f4fc4b4ff57bb6e19c093a6135f2aff85bc` |
| `runtime.py` | `c3f8f3c0f3fef84bba26564e85cad706434e11cde571cdf26c3af8addad4c4d5` |
| `runtime_port.py` | `560569756de0992aebfe6e23385c992652c6f16c25b0ec6e575c1c3e229a00a9` |
| `request_recovery.py` | `ad9ce1249949723fe9bd013b804de24a473fd9bc61609584e32748520f917af5` |
| `reader_state.py` | `0d76d683ac78b10363401d449e9b958936c0aca8c0c12dcacc7275e291006edf` |
| `retention.py` | `3b88035e38e52da3a313ee1802ed5a0cfcd7799c9674c468dda6578d8926718c` |
| `template_clarification.py` | `0af1d23eeb5f54a988c5b4cd5f3c51d8910695e6598e6eb9ae8472f4961148dc` |
| `legacy_voice.py` | `14d4b6b416a0a7bdcc65bab09da484202de213668d9d21e693d805a095af4dd8` |
| `parameter_collection_runtime.py` | `3f6a175999196f400ae66baf26fa3810806563d13143530b7d99a21fda1be728` |

Evidence reference: `NATIVE_CLARIFICATION_SOURCE_PROVENANCE_R2.json`,
SHA256 `b43bd4ab51678247ee598716321d0d2710cbc9415751c57f20dc5ff57464ed1a`.
The earlier R1 diagnostic stopped on an unsupported assumption that every
historical file had one hardlink; it remains a separate failed observation.
R2 retained nofollow/CAS, ownership, manifest and exact source checks and removed
only that added diagnostic assumption. Historical hardlinks are not a pin failure.

These ten identities are the fresh installed comparison. Other fixture
dependencies have public archive/R4/R5 provenance; this is not a fresh assertion
that every file/configuration of the installed release matches the synthetic
fixture.

## Seven bounded checks

| Case | Actual exercised boundary | Independent observation |
| --- | --- | --- |
| Worker loss and restart | Existing template selection, marketplace request, Worker failure handling, SQLite commit; child exits after persisted UNKNOWN | Synthetic journal is exactly one selector plus one `ozon_orders`; calls ledger is RECEIVED then UNKNOWN/`UNEXPECTED_TRANSPORT_OUTCOME`; same job/key after reopen |
| Same acceptance, cancel and clarification | RuntimePort submit replay, same logical identity, changed-body rejection, result read, cancel, clarify and Worker claim | Old receipt remains ACCEPTED; separate status is UNKNOWN/`UNKNOWN_OUTCOME`, retryable false; cancel false, clarify RESULT_EXPIRED; job unchanged, no new sends |
| Retention and exact-key refresh | Actual sweeps after the non-model 90000-second and model 604800-second deadlines, then Repository.enqueue of saved original admission | After the first sweep, non-model calls are 0 and model calls are 1; after the second both are 0. Payload/refs/receipts expire separately, UNKNOWN/key/slot and the synthetic send journal remain; the exact admitted key joins UNKNOWN |
| Unsafe crash | Actual Repository.claim/reserve with default `resume_safe=0`, durable marker, abrupt child exit before receipt | Parent first sees RUNNING/SENDING, then lease recovery yields UNKNOWN/`LEASE_EXPIRED`; stale owner rejected, no new marker |
| Safe read crash control | Actual Worker read sets `resume_safe=1`; transport marks send and abruptly exits | Parent first sees RUNNING/SENDING, then QUEUED before redispatch; new claim owner, stale owner rejected, normal completion READY |
| Legacy pending branch | Real station-guarded template job becomes UNKNOWN; real selected-reader scope and `continue_selected` | Answer/cancel/result do not enter pending continuation; job and journal unchanged; no Station IPC/authentication claim |
| Independent work control | A distinct newly admitted question using real queue and successful synthetic transport | New job reaches READY while original job remains UNKNOWN; exact additional selector/marketplace/final-answer counts |

The existing archive already has narrower tests such as
`tests/test_runtime.py::test_unknown_cannot_refresh` and
`tests/test_runtime_port_r01_contract.py::test_unknown_never_retries`.
This qualification adds the combined current-version boundaries: independent
durable send journal, process exit and reopen, actual template marketplace loss,
port acceptance versus outcome, legacy selection, retained tombstone after
the distinct payload, replay, non-model and model windows, safe recovery
control, and unrelated work progress.
It does not redefine the product's state machine.

### Exact interpretation of retry and visibility

A synthetic unexpected transport exception is used for the Worker UNKNOWN
case. The exact stored code must be `UNEXPECTED_TRANSPORT_OUTCOME`.
An accidental fixture error yielding `WORKER_INTERNAL_UNKNOWN` cannot pass.
The raw synthetic exception detail must not appear in the public status/text.

`CallError.unknown` alone is not the same as a persisted UNKNOWN job.
Existing recovery can retry repeat-safe reads for recognized transient errors
such as `NETWORK_OUTCOME_UNKNOWN` or transient HTTP statuses before a durable
UNKNOWN outcome is established. The positive safe-read crash control preserves
this behavior. No retry policy or `resume_safe` value is monkeypatched.

The unsafe crash is explicitly a lower-level repository contract. Its synthetic
journal is proof of local fixture ordering across process exit, not evidence of
a real marketplace dispatch or remote outcome. No power-loss durability claim
is made.

A submit replay can correctly return the historical ACCEPTED receipt even
though current status is UNKNOWN. The receipt does not rename the current job
to success. The script checks the separate status and immutable job identity.

After 24 hours the public references/acceptance receipts may expire. Non-model
call records have a separate 90000-second TTL. Model calls have the independent
seven-day accounting window, `model_usage.WINDOW_SECONDS = 604800`;
`retention.sweep` excludes them from the non-model deletion. Their eventual
absence does not mean a request was never sent. The independent synthetic sent
journal remains available to prove that distinction. The corrected qualifier
records each observed category count before asserting it, including on failure.

The retention check uses the exact saved admission plan/key. A different
question, request identity or calendar date can produce a distinct key in
template mode. This test does not claim an indefinite global prohibition on
such new work or that an expired public reference still resolves.

Reason visibility here is the current native safe code/text plus a safe stored
cause in the synthetic fixture. The operator incident screen, permissible
reconciliation path, staff action effects, and no-force-READY UI are still
unimplemented/unqualified in this source scope.

## Execution and resource boundary

The same public command works from a suitable checkout. The output file must
not already exist; choose a new receipt path for each approved source execution.

```bash
python3 -I -B products/alisa/tests/runtime_authority/unknown_lifecycle.py --output /absolute/owned/output/unknown-lifecycle-source.json
```

The output directory must already exist. The script has no runtime dependency
beyond Python's standard library and the pinned public fixture. It does not
require Django, PostgreSQL, a provider credential, an AF_UNIX service, or a
running installed application.

Execution uses one new owned `/tmp/alisa-unknown-source-*` tree (0700), with
SQLite/JSON files containing synthetic data only. The native source subtree
is read-only. A parent PID and exact script hash bind internal child modes to
that owned tree. No pre-existing fixture directory is adopted.

Limits are 60 seconds for the outer qualifier, 10 seconds per sequential
child wait (child's own alarm is 8 seconds), 256 MiB address space and 45 CPU
seconds per process, a 16 MiB file-size limit, and 128 descriptors.
At most two processes are active at a time, so the per-process memory limit
must not be described as a 256 MiB aggregate cgroup cap.
Subprocesses have a minimal environment, closed unrelated descriptors,
separate process groups, and bounded kill/wait cleanup.
All socket and HTTP audit events are rejected and counted.

The qualifier captures product output without forwarding it. Its JSON receipt
contains source hashes, environment versions, fixed case names, safe codes,
counts, child exit/reap observations, elapsed time, and cleanup observations;
it excludes synthetic payloads, authority tickets, raw exceptions and source
values. The final stdout is a small status/check-count/receipt-hash object.
The owned temporary tree is removed and all children are reaped on success or
normal failure. The receipt survives outside that tree.

This is an explicit standalone source qualification. It is **not integrated
into existing CI**. The current exact suite inventory and existing pipelines
are not changed merely to route this new script.

## Actual R1 result and narrow correction

The first approved execution used script SHA256
`c76616eefbca9f2a6847194a42b1f7b6786aa7741b9d194a3546332e092ea12b`
and document SHA256
`99e402be960aa5cc64bcc3a3a23d300096d7fb63703d6a6fda311c773b095801`.
Those exact files are preserved in historical source commit
`e913c97e0d3f9485e302329c0b1c24e1081e4e98` on
`feat/alisa-unknown-lifecycle-source-20261116`; publishing that source was not a
qualification PASS or installation.
It exited **2 / FAIL** after **1.640 seconds**, with two completed case PASS
records and `SEPARATE_RETENTION_WINDOWS` at the third case. The four later
cases were not reached. This failed observation is retained and is not a
seven-case qualification PASS.

R1 receipt `QUALIFICATION_R1.json`, 5195 bytes, SHA256
`e51f6cd6bcea33f59f38ed3fb2e613a75f5ab89c6dbb7b3148f3e7761c7f2a57`;
execution record `RUN_R1_EXECUTION.json`, 1049 bytes, SHA256
`42d975416c674a363c37f1f5946331679a987e423a643aa12f726b73038fea0e`;
immediate source precheck `RUN_R1_PRECHECK.json`, 449 bytes, SHA256
`37961d47c3edbc55e584a49731ac752cfddb435b327db792d96a70cae1e2c8f4`.

The actual environment was Python 3.12.14 / SQLite 3.53.1 on Linux. All 183
fixture files passed the pre-import source gate; fixture manifest SHA256 was
`d6db7ffac22ecb729e85ef60a81eef227e223492af81ee3a8c0a43cc87bb9be1`.
The first child exited 75 with zero output and was reaped. Product captured
output and network attempts were both zero. Both cleanup observations were
true: temporary tree removed and children reaped. The final post-run source
gate was not reached, so this result does not claim that final gate passed.

The failed assertion incorrectly expected the entire call ledger to be empty
after 90000 seconds. Source review of `repository.py:69-70`,
`model_usage.py:15,19-32`, and `retention.py:110-119` established the separate
model seven-day window. R1 did not record per-category counts, so a surviving
model count is a source-supported explanation, not a measured R1 value.

The correction changes only qualification assertions/observations and this
document: require non-model 0 / model 1 after the first window, then model 0
after its own window, while retaining the UNKNOWN/key/slot/journal and final
exact-key join checks. It does not change retention or any runtime module.
The corrected source received independent delta review and a separately
authorized single execution. Its actual result follows; no automatic retry
was performed.

## Actual corrected-source R2 result

The first execution of the corrected script, SHA256
`7b9889c6272dc9428c65130e73e4615d43d5cef13190838844d4832d07db5e53`,
completed **PASS / exit 0**, **7 of 7 cases**, in **3.376 seconds**. The exact
pre-run document SHA256 was
`ff8de8eb8a4e85f83cbd2d017fa86ea5587fffda2a600dcdcfabc7bf687ed400`;
this subsequent update adds observed results only, without changing the
qualified executable. No further executions were needed.

The actual command, after an immediate check of both source hashes and absence
of the new receipt, was:

```bash
python3 -I -B /workspace/scratch/764c6b17e9de/unknown-lifecycle-source-20261116/products/alisa/tests/runtime_authority/unknown_lifecycle.py --output /workspace/scratch/764c6b17e9de/unknown-lifecycle-inputs-20261116/QUALIFICATION_R2.json
```

The wrapper executed Python with only `PATH=/usr/bin:/bin` and `LANG=C.UTF-8`.
Stdout and stderr were captured separately into new files. These are observation
paths from the qualifying workspace; the reusable public CLI above remains
checkout-relative and does not require those paths.

| Actual check | Result and measured evidence |
| --- | --- |
| Worker lost response and reopen | PASS. One synthetic template selector and one synthetic `ozon_orders` dispatch; persisted `UNKNOWN` / `UNEXPECTED_TRANSPORT_OUTCOME`; public `UNKNOWN_OUTCOME`, private detail absent |
| Existing acceptance, cancel and clarify | PASS. Original receipt `ACCEPTED`, actual state `UNKNOWN`, one job; cancel false; clarification `RESULT_EXPIRED`; stored safe bit 1 did not revive UNKNOWN; zero new dispatches |
| Retention and exact-key refresh | PASS. After 90000 seconds: model calls 1, non-model calls 0, refs 0, receipts 0. After 604800 seconds from model dispatch: both call categories 0. Payload removed, UNKNOWN/key/slot/journal retained; exact-key refresh JOIN remained UNKNOWN with no dispatch |
| Default unsafe repository crash | PASS. Actual child exited after one durable synthetic marker; recovery `UNKNOWN` / `LEASE_EXPIRED`; stale owner rejected; no redispatch |
| Safe Worker crash control | PASS. Recovery was QUEUED before a new claim; the new owner was observed, old-owner write rejected without row mutation; normal completion READY, two synthetic sends across crash/recovery |
| Legacy pending branch | PASS. Actual selected row carried the synthetic station guard and remained UNKNOWN; no pending continuation and no additional sends |
| Independent new work | PASS. A distinct job reached READY while the original stayed UNKNOWN; exact additional selector/marketplace/final-answer sequence |

The environment was **Linux / Python 3.12.14 / SQLite 3.53.1** with isolation
and bytecode suppression enabled. The same **183-file** fixture manifest
`d6db7ffac22ecb729e85ef60a81eef227e223492af81ee3a8c0a43cc87bb9be1`
passed the pre-import and final post-run gates. The recorded 13 source input
pins, archive pin, and ten installed-source comparison pins were unchanged.

The three child exit statuses were **75, 73, 73** for persisted UNKNOWN,
unsafe crash, and safe crash respectively. Each child had **zero output** and
was **reaped**. Captured product output was **0 bytes**; network attempts were
**0**. Both cleanup observations were true: the temporary tree was removed and
all children reaped. Limits remained 60-second outer wall, 8-second child alarm /
10-second parent wait, 45 CPU seconds and 256 MiB address space per process,
maximum two simultaneous processes, 16 MiB file size and 128 descriptors.

| Retained R2 artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `QUALIFICATION_R2.json` | 7438 | `80740a0e800f72fdd66202a4dbad411b38962ee6f3cf1b8d39d453b02905b176` |
| `RUN_R2_EXECUTION.json` | 875 | `10781afead157b67be067186c22a36617e8b8bc19399c59f5265ccadb149a8b0` |
| `RUN_R2_PRECHECK.json` | 465 | `e76473ef83629710241187cecc5596a3076818c5c031f31834c9a1fba22a9000` |
| `RUN_R2_STDOUT.txt` | 118 | `eec54091c7cf60994f6768c6f84bb02d62d8a15dd17ed175cea7226da5ffb472` |
| `RUN_R2_STDERR.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

These results are standalone synthetic source evidence. Existing roadmap
PARTIAL evidence is preserved; this execution does not qualify the operator
screen, reconciliation endpoint, actual provider outcome, or live deployment.

## Remaining limits and next action

Independent source review preceded each bounded execution. A pin or
fixture failure is recorded as such; it is not repaired by weakening a pin,
changing installed code, skipping a case, or replacing a real module with a stub.

A passing receipt can support only the seven stated source boundaries.
It neither identifies nor resolves the four previously observed live UNKNOWN
jobs, grants a deployment window, changes readiness, authorizes deletion, nor
confirms any real provider outcome. The four are not labelled test leftovers.

The current native clarification extension requires a READY pending result;
legacy continuation repeats that guard. Its low-level requeue/cancel helpers
are not operator reconciliation APIs. The R5 parameter attach only adds an
admission authority; it does not replace UNKNOWN resolution.

Further product work needs the approved operator/auth/evidence/effect contract
implemented and qualified through its actual interface. Any live resolution
still requires the identified run/request/job and actual outcome, retaining
identity and the no-replay boundary.
