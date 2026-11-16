# UNKNOWN lifecycle: bounded source qualification, 16 November 2026

## Status and scope

**Source draft; qualification execution NOT_RUN at this freeze.**
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
| Retention and exact-key refresh | Actual retention sweep after payload/replay/ledger deadlines, then Repository.enqueue of saved original admission | Payload removed, UNKNOWN/key/slot retained, refs/receipts/call ledger independently expire; same admitted key joins UNKNOWN; durable synthetic send journal unchanged |
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
all three TTLs, safe recovery control, and unrelated work progress.
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

After 24 hours the public references/acceptance receipts may expire; the call
ledger has a distinct 90000-second TTL. Their absence does not mean a request
was never sent. The independent synthetic sent journal remains available to
prove that distinction.

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

## Remaining limits and next action

Independent source review must precede the first bounded execution. A pin or
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
