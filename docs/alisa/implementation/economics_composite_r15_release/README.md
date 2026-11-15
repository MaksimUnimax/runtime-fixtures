# R15 release preparation and owner compatibility gate

15 November 2026. **Candidate-builder source only; no production build or deployment.**

The code is in `docs/alisa/runtime/v0.11/economics_composite_r15_release/`. The author owns only that new directory and this implementation directory. Shared R15 runtime, platform, CI and installed files are not edited here.

## Why a separate release builder is required

Fresh read-only service and manifest checks confirmed different active platform and authority bases. Platform contains the later customer login/catalogue changes; web contains the accepted guidance changes. Native/authority remain R5. Rebuilding from the testing fixture or running the old S11→R5 activator would discard this distinction.

The new builder independently copies all manifested files for platform, authority and native; applies an explicit R15 overlay; preserves web and publisher references; pins the used Python/Node/dependency environment; verifies catalogue preservation; and produces immutable manifest-bound artifacts. It reads only safe live service/reference metadata. There is no deployment, environment export, DB connection, queue operation, credential change or provider/LLM call in the builder.

All source hashes and native PINs are computed from the supplied final source. Updating source or tool files after `plan` invalidates the plan and build. No work-in-progress PIN is embedded in this release code.

Independent review found and reproduced a source-closure gap in the first builder draft: changed preserved owner input code could be absent from the source manifest. This is corrected by 59 role-aware compatibility guards, 96 pinned source inputs, native shared-support equality, explicit before/after replacement records and strict exceptions for the already accepted login/staff divergences. A second probe found package-import aliases could evade the AST closure check; both absolute and relative package imports now require declared modules. Direct-copy output hashes are also tied to source inputs. No shared production module was changed to make a packaging guard pass.

Root independently inspected the actual installed-to-source diffs and approved exactly the four replacement tuples and three role-specific preservation tuples recorded in `compatibility_review.json`. Full economics admission remains WEB-only; new flags default off and the existing voice continuation branch is preserved. This review concerns packaging compatibility, not new staff policy or live acceptance.

The first actual read-only PLAN attempt on published source `888cf0aaf10b22a689fca26241beac1ae197be83` exited 2 with `LIVE_SERVICE_BASE_CHANGED:web` and emitted no PLAN bytes. Independent readback at 10:20:20 UTC confirmed the same four pinned releases and manifests. The web unit starts at `web-current`, which resolves to the pinned release root, while its main Node process cwd is that release's `ui/web/apps/web`. Platform and native use their release roots for both cwd checks; authority uses `services/platform` for both. The baseline now pins `unit_cwd_suffix` and `process_cwd_suffix` separately, and the observation records both exact resolved paths. There is no prefix fallback or changed pointer guard. Three regression tests reproduce this four-role shape and reject a wrong unit cwd or process cwd, including another directory within the correct release. No live configuration was changed, and the corrected real PLAN remains a separate root-run gate.

## Current owner compatibility: known distinction, unknown rows

The installed `owner_data/source.py` (`717811b6…`) requires exactly one active SELLER and PERFORMANCE credential, each with `check_code == CONNECTED`. Installed `runtime_adapter/authority.py` (`c4040af2…`) also accepts `CONNECTED_NATIVE_OWNER`. Store UI projection may show the latter as connected. This difference was verified from source; current credential rows were not queried.

There is no existing all-in-one, boolean-only owner compatibility endpoint/helper in the inspected source. `DjangoOwnerSource.current()` is the actual strict source gate, but it locks rows with `SELECT FOR UPDATE`, validates and returns owner facts. It is not suitable for a metadata-only PostgreSQL read-only diagnostic. `owner_data.runtime_rpc.prepare_for_runtime()` additionally creates a signed ticket. `_TicketSource` must only be constructed after the existing ticket verification; constructing one from arbitrary IDs would bypass its intended boundary.

### Concrete bounded metadata preflight

Required target context: the already identified owner's `product_id=alisa_market`, tenant UUID, customer UUID, selected Ozon store UUID, and intended report period/profile `unit_economics.ozon.v1`. Obtain these from the existing authorized application/test context; do not enumerate customers, extract session tokens, create a synthetic Query or mint a new owner ticket. For a full authenticated check later, use the genuine admitted Query/private peer and current session binding.

An existing Django runtime identity can perform a narrowly scoped `transaction.atomic()` with `SET TRANSACTION READ ONLY` and these existing model reads. No such diagnostic was executed in this task:

| Check | Existing model/method and exact scope | Permitted output |
|---|---|---|
| Credentials | `CredentialRevision.objects.filter(product_id=PRODUCT, tenant_id=tenant, store_id=store, kind=kind, status='ACTIVE').values_list('check_code', flat=True)[:2]`, once each for SELLER/PERFORMANCE | `MISSING`, `AMBIGUOUS`, or the stored `check_code`; strict-compatible boolean |
| Owner/selected store | `Customer`, `Membership(role='OWNER_CLIENT')`, `Store`, all constrained to the supplied IDs/product/tenant | active, ownership, provider and verified-identity booleans; no identity string |
| Approval | `OwnerDataset` for that product/tenant/store, selecting only `status`, `approval_id`, `approved_by_id`, `approved_security_revision`, `catalog_hash` | approved, approver/security-match and current-catalog booleans; no UUIDs or hashes in output |
| Owner input contract | Existing `owner_data.service.RESOLVER.hash` and registered owner input catalogue fields | `unit_cost`, `tax_amount`, `own_cost_amount` registered booleans |
| Active web work | Existing `queries.models.Query` filter from R5 `migration.py --state`: state in UNKNOWN/QUEUED/RUNNING/NEEDS_CLARIFICATION and `expires_at > now` | idle boolean or existing typed busy code |

`OwnerDataset` has no profile-ready column. An approved dataset and current catalogue do not prove COGS/SKU/day or exact tax/own-cost period coverage. The metadata response must leave `profile_coverage=NOT_CHECKED`. That later gate uses the real qualified order readset through current owner resolution and exports only success/missing/error information, never raw owner values in diagnostic logs. Do not relabel `CONNECTED_NATIVE_OWNER`, weaken strict source policy or change grants to manufacture readiness.

### Existing queue/delivery helper boundaries

The installed `/root/alisa-parameters-install-20261114-r5/migration.py` exists with SHA256 `1a24bcf3d9280bfaa1b0276906fc619a4120f9f9d5223ffa4ad18b2fbd942b02`. Its `--state` branch sets `default_transaction_read_only=on` and returns the active Query count. It bootstraps through existing `/root/alisa-s09-clarification-install-20261113-d11a9f2a/migrate.py`, pinned at `d99b391ec428e23a4c41f106828887d43b501fbf892f9954cd65b9a92dd59e78`. Independent source review established that bootstrap uses the migration identity. Do not reuse that identity for the owner metadata preflight: use the normal runtime role with a read-only connection. `--check` and `--apply` are different operations; `--check` writes a receipt and must not be called as a pure read.

The separately discovered accepted context anchor is `/root/alisa-user-acceptance-gap-fix-20261115/LIVE_OWNER.json`, JSON pointer `/finance/query_id`, file SHA256 `b272f4da25040970b84ca817881f8dd915c3918dafdf76aeb4a298fdaee24a9b`. No identifier value is included here. A separate reviewed metadata helper may derive the target internally from that exact existing Query and exactly one Ozon store. Query has no `product_id`; check product on the scoped Store. That helper is a separate scope and is not called by this builder.

The existing R5 `activate.snapshot()` shows the approved read pattern for native idle/delivery: open the existing configured SQLite database using `file:…?mode=ro`; count QUEUED/RUNNING jobs and retained unexpired results; inspect only `job.delivery` in existing station state files and require `responded_to_skill`. It then checks active web Queries. This function embeds old TARGETS/config paths and calls the older installed helper, so it must not be invoked wholesale for R15 or treated as a new safe generic command. A later bounded preflight must use the actual installed configuration identity/path internally and return only booleans/codes. No native DB, station state, env, session, key or grant was read while preparing this document.

## Acceptance and remaining actions

[PR425](https://github.com/MaksimUnimax/runtime-fixtures/pull/425) and [PR434](https://github.com/MaksimUnimax/runtime-fixtures/pull/434) document the accepted login/catalogue/web scenarios. The [15 November acceptance matrix](https://github.com/MaksimUnimax/runtime-fixtures/blob/7771fd22c6a94cec90e889f46a885694e9d313d4/docs/alisa/quality/USER_ACCEPTANCE_2026-11-15.md) leaves annual coefficient saving, voice and the complete economics composite open. The [19-scenario handoff](https://github.com/MaksimUnimax/runtime-fixtures/pull/421#issuecomment-6876875650) has no observed full closing acknowledgement. Current browser activity is not inferred from that historical handoff; coordinate a fresh switch window without touching its session.

The next work is final source CI/review, a bounded metadata compatibility preflight, the exact real-environment candidate plan/build/verification, then installed qualification and a separately reviewed activation/rollback. Activation must preserve accepted web/catalogue/publisher changes, current owner settings and existing rights; drain active work under the common rollout lock; update all native policy/version PINs from this candidate; verify journal delivery; and perform the real owner scenario without repeating an already completed annual collection. Missing or unqualified real financial sources remain typed failures/incompleteness rather than zero.

The previous frozen builder passed its 32 author tests and six additional independent review scopes. After the explicit unit/process cwd correction, the author gate is **35/35 PASS in 2.909 seconds**, including the three new path regressions and the actual source prepare/import chain. AST parsing and the actual-source import-closure check also pass. Independent delta review and the corrected real read-only PLAN are separate gates. These are evidence only for their stated scopes. A full-copy build also preserves the previous 3 GiB/200000-inode rollout reserve; the observed `/var/tmp` free space cannot accommodate this candidate while preserving that reserve. No production candidate, deployment receipt, live owner acceptance or completion claim is made in this change.
