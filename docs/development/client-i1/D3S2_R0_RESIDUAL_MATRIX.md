# D3/S2 R0 — Residual classification matrix

Every A01–A32 row has exactly one primary category. “PASS” language below is
limited to the bounded local automated scope in the Early-I1 receipt; it is not
live-product acceptance.

## Primary matrix

| Requirement | Current implementation evidence | Primary category | Dependencies / exact files | Acceptance gap |
|---|---|---|---|---|
| A01 / SA-UX-01, SA-SHOP-01 | Popup Ozon/WB switch, multiple stable local store IDs, generated names and rename in `packages/bridge-core/src/stores/catalog.js`, `apps/extension/src/application/popup.js`; C3H/C1 evidence | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | Local catalog and popup; no server metadata catalog | Wider live-account/provider proof remains outside this receipt |
| A02 / SA-SHOP-02,03 | Separate Ozon Seller/Performance credential slots and provider dispatch paths; live rights/expiry/provider identity are not in the candidate | `OWNER_EXTERNAL_ACTION_DEFERRED` | `catalog.js`; Ozon provider/credential modules; live Seller and Performance accounts required | No live proof of rights, expiry, or confirmed providerAccountId |
| A03 / SA-SHOP-04 | The accepted bounded local behavior remains PASS_AUTOMATED_CURRENT_SCOPE: local delete ends/fences local work and a late result cannot attach to another store; there is no dedicated server store tombstone/current-store metadata entity yet | `EXTEND_CURRENT_MODEL` | Extend C3E/C3F `/v1/sync`, `sync_entities`, and local catalog; do not add a second sync | D3/S2 extends this accepted bounded behavior with account-scoped metadata, credentialRevision/provider identity convergence, and cross-install deletion tombstones |
| A04 / SA-WORK-01, SA-AI-01 | Explicit Start, historical baseline, old-command inertness, supported ChatGPT/Alice fixtures | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | C3D/C3H lifecycle and AI adapter surfaces | Full real AI-family matrix |
| A05 / SA-WORK-02 | Explicit store/marketplace rebind, warning, new binding revision, generation/context fences | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | C3D/C3F/C3G; `runtime.js`, reconciliation kernel | Live account/provider rebind gate |
| A06 / SA-WORK-03 | Finish cancels future local work, fences late callbacks, preserves already-sent outcomes | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | C3D/C3F/P2; work state and delivery models | Broader installed/browser matrix |
| A07 / SA-CMD-01 | Sequential explicit batch execution and single-click behavior | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | Core batch queue and C3H fixtures | Live provider execution not claimed |
| A08 / SA-CMD-02,03 | Schema/help/unknown/mutation/forbidden-network gates | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | Provider adapters and C3G predispatch | Live API coverage |
| A09 / SA-CMD-02 | No hidden polling, pagination, or retry in current product path | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | C3G/P3 static and runtime gates | None for this bounded scope |
| A10 / SA-DATA-01, SA-CMD-03 | P1/P2 buffers, exact file fixtures, transaction and one-hour expiry rules | `OWNER_DEFERRED_TEST` | P2 result recovery, delivery model, P3 expiry | All real AI upload UIs, sizes, sleep/restart combinations |
| A11 / SA-DATA-01,02 | Bounded expiry and cleanup with no business archive | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | P2/P3 result/artifact cleanup | Full wall-clock installed evidence |
| A12 / SA-WORK-01, SA-CMD-01, SA-DATA-02 | Restart/double-click/provider UNKNOWN/AI delivery no-replay | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | P1/P2/P3 | Wider browser-family evidence |
| A13 / SA-AUTH-01 | Account-scoped local storage, auth generation, reset/revoke fences; live owner logout/session evidence absent | `OWNER_DEFERRED_TEST` | C2/C3C and catalog account scope | Owner-authenticated logout/retain/delete and live account switch |
| A14 / SA-BETA-01 | Atomic beta admission and idempotency suites | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | Existing server beta-access package | Production operations not claimed |
| A15 / SA-BETA-01,02 | Admission/capacity/existing-login/concurrency policy tests | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | Existing beta and device-management packages | Live operations not claimed |
| A16 / SA-BETA-02 | BETA separated from checkout/timer/commercial device limit in tested policy | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | Bootstrap/device policy | Release operations not claimed |
| A17 / SA-SYNC-01, SA-QUOTA-01 | One local executor and local account/provider limiter; no browser-to-browser quota lease | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | C3D/P1/P3 and provider quota modules | Live cross-browser quota observation |
| A18 / SA-SYNC-01,02 | Partition independence and optional bounded reconcile | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | C3E/C3F/C3H | Browser/live evidence remains bounded |
| A19 / SA-SYNC-02 | Pending backlog/conflict/failure isolation | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | C3E journal and C3F per-entity state | Production monitoring is not this row |
| A20 / SA-SYNC-01, SA-WORK-02 | BindingRevision/Finish/late ACK/clock/order fences | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | C3F/C3G | No new model required |
| A21 / SA-QUOTA-01 | Retry-After is provider-local; no hidden replay; P1/P3 re-gate | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | P1 provider outcome, P3 scheduler, `prepareProviderQuotaForCommand.js` | Live provider proof |
| A22 / SA-KEY-01 | No transfer implementation exists | `NEW_BOUNDED_FEATURE` | Reuse auth/device identity and existing metadata transport only for control metadata | Full A22 transfer protocol and privacy gates |
| A23 / SA-KEY-01, SA-AUTH-01 | No recipient key protocol, relay lifecycle, ACK, or replay fence exists | `NEW_BOUNDED_FEATURE` | New transfer contracts/storage boundary; C3E journal must not carry secret payload | Account substitution, expiry, revoke/logout, repeat-packet gates |
| A24 / SA-KEY-02 | No encrypted all-store export/import implementation exists | `NEW_BOUNDED_FEATURE` | Local catalog plus WebCrypto/standard library; independent of transfer | Format, KDF, integrity, conflict, bounds, no-auto-Work gates |
| A25 / SA-AI-01, SA-CMD-03 | Synthetic composer/send/UNKNOWN and attachment evidence | `OWNER_DEFERRED_TEST` | Existing AI adapters and delivery model | Live AI upload/composer variants |
| A26 / SA-BROWSER-01 | Playwright Chromium proof only; Google Chrome/Opera/Yandex/Firefox/Safari deferred | `ENVIRONMENT_DEFERRED` | Browser acceptance environment | Real browser/OS matrix |
| A27 / SA-ADMIN-01 | Server admin/RBAC/test pieces exist; full beta operations/security statistics are not D3/S2 receipt | `LATER_Q1` | Existing admin packages | Q1 operational/security acceptance |
| A28 / SA-OBS-01 | Monitoring-agent implementation is intentionally outside this stream | `STREAM_2_DEPENDENCY` | `apps/health-runner/**`, `packages/server/health/**`, `tooling/api-watch/**` | Stream 2 evidence and implementation |
| A29 / SA-RELEASE-01 | Local development ZIP only; no preprod/prod release or rollback | `LATER_Q1` | Release/deployment workflow | Q1 release and recovery acceptance |
| A30 / SA-AUTH-01, SA-SYNC-02 | Fresh/grace/expired/tamper/revoke/invalidation authority matrix | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | C2/C3C/C3G | Live-owner gates remain separate |
| A31 / SA-SYNC-01,02 | Ordinary provider command/delivery has zero mandatory control calls; pending sync is separate | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | C3E/C3H/C3G/P2/P3 | No control-call regression allowed |
| A32 / SA-SHOP-01, SA-WORK-01 | Ozon/WB and multiple-store/dialogue isolation in synthetic/native scope | `ALREADY_IMPLEMENTED_BY_EARLY_I1` | Catalog, context, C3H | Live account isolation |

## Required area reconciliation

### Store product state

Already present locally: multiple stores, stable IDs, generated names,
rename, Ozon Seller plus optional Performance credentials, WB token shape,
account-scoped catalog, credentialRevision, and local invalidation/fencing.
The catalog never uses the display name as identity and does not silently
replace a provider account under an existing store ID.

Not present as a complete product model: confirmed `providerAccountId`,
server-owned store metadata list/rename/delete state, cross-install tombstone
convergence, and live provider-rights/expiry proof. Ozon Seller-only remains a
valid partial state; Performance is not required for Seller operations. WB
requirements remain provider-specific and are not inferred from Ozon.

### Full sync/reconciliation

C3E is the current journal and authenticated `/v1/sync` transport. C3F is the
current reconciliation kernel. They already cover bounded entries, stable
request IDs, server revisions, base revisions, ACK generation safety, stale
conflict classification, bindingRevision, Finish precedence, delivery markers,
preferredExecutor metadata, disconnected `UNKNOWN_REMOTE_INSTALLATION_STATE`,
per-entity isolation, and recovery without Work/provider/result replay.

The gap is broader store metadata and delete tombstone propagation. That is an
extension of the same allowlisted C3E/C3F state/transport and `sync_entities`
repository, not permission to create a second journal, queue, lease, or
reconciliation authority. The A03 bounded local delete/late-result acceptance
remains PASS_AUTOMATED_CURRENT_SCOPE; D3/S2 store-state convergence is a
separate extension of that scope. `credentialRevision` already crosses the binding
sync payload and is consumed in local execution fences; its store-metadata
projection and rotation/identity rules need explicit extension.

### Provider quota

P1/P3 already provide the local installation/account/provider limiter,
Retry-After semantics, durable technical wake, full last-mile re-gating, and
no automatic replay for UNKNOWN provider outcomes. No central browser-to-browser
quota lease is present or required. D3/S2 must not add one.

### Beta-safe operability

Allowlisted technical reason codes and metadata-only sync diagnostics are
available. No raw seller report, conversation body, credential, token, or
storageState may become telemetry. Health/API watcher implementation remains
Stream 2-owned. Any D3/S2 diagnostics addition must be a small product-side
allowlisted projection and must not duplicate monitoring agents.

## Category counts

Counts are over the 32 primary A01–A32 rows above:

| Category | Count |
|---|---:|
| `ALREADY_IMPLEMENTED_BY_EARLY_I1` | 20 |
| `EXTEND_CURRENT_MODEL` | 1 |
| `NEW_BOUNDED_FEATURE` | 3 |
| `OWNER_DEFERRED_TEST` | 3 |
| `OWNER_EXTERNAL_ACTION_DEFERRED` | 1 |
| `ENVIRONMENT_DEFERRED` | 1 |
| `STREAM_2_DEPENDENCY` | 1 |
| `PARALLEL_STREAM_DEPENDENCY` | 0 |
| `LATER_Q1` | 2 |
| `NOT_APPLICABLE / SUPERSEDED` | 0 |
| **Total** | **32** |

## Full category lists

ALREADY_IMPLEMENTED_BY_EARLY_I1: A01, A04, A05, A06, A07, A08, A09, A11,
A12, A14, A15, A16, A17, A18, A19, A20, A21, A30, A31, A32.

EXTEND_CURRENT_MODEL: A03 (delete/tombstone and broader store state over the
existing C3E/C3F model), plus the store metadata details described above.

NEW_BOUNDED_FEATURE: A22 credential transfer, A23 transfer security/lifecycle,
A24 export/import.

OWNER_DEFERRED_TEST: A10 large/live AI data delivery, A13 live owner
logout/account session, A25 live AI composer/upload variants.

OWNER_EXTERNAL_ACTION_DEFERRED: A02 live provider account/rights/expiry
verification for Ozon Seller/Performance and providerAccountId.

ENVIRONMENT_DEFERRED: A26 browser-family/OS acceptance.

STREAM_2_DEPENDENCY: A28 monitoring agents and their dedicated evidence.

LATER_Q1: A27 full admin/operability acceptance and A29 release/preprod/
rollback acceptance.
