# C2.3-C3B — Autonomy source-of-truth recovery and dependency audit

**WORK_ID:** `SA-I1-C2-3-C3B-AUTONOMY-SOURCE-OF-TRUTH-RECOVERY-20260918-01`
**Repository:** `MaksimUnimax/runtime-fixtures`
**Audit date:** 2026-09-18
**Status:** `C3B_AUDIT_COMPLETE_WITH_EVIDENCE_GAPS`
**Scope:** source and dependency audit only. No production code, tests, contracts, migrations, OpenAPI, STATUS acceptance, or C3C work was changed.

## 1. Executive finding

The current local post-D3A implementation has one accepted signed-cache acquisition path but two incompatible Work consumers:

1. C1/C2 online admission (`saAdmitOnline`) requires current `canWork()`, an online `FRESH` Bootstrap projection, and a Seller Agents `/v1/health-authority` round trip.
2. C3A dispatch (`saEvaluateDispatchAuthority`) calls a pure offline evaluator, but only with `operation: "CONTINUE"`, `active_visible`/`active_hidden` Work, and an exact `ONLINE_VERIFIED` admission receipt.

The accepted cache client does distinguish `FRESH`, `STALE_BUT_OFFLINE_GRACE_ELIGIBLE`, and `CACHE_EXPIRED`; however, Work admission does not call `bootstrapWithPolicy()`, the C3A evaluator rejects any operation other than `CONTINUE`, and both the evaluator and final dispatch fence use `expiresAt` rather than consuming `offlineGraceUntil`. Consequently, temporary Seller Agents unavailability denies new Start, historical Start, Resume, and rebind, and denies active continuation at `expiresAt` even while signed offline grace remains valid.

This is a structural authority-model mismatch. C3C must replace or redesign the C1/C2/C3A authority/provenance dependencies as one model. An exception around `server unavailable` is not an acceptable implementation direction.

## 2. Exact Git facts and lineage

### Remote refs after normal fetch

`git fetch origin --prune` completed without force, reset, rebase, amend, or deletion of untracked files.

| Ref | Exact commit | Exact tree | Result |
|---|---|---|---|
| `origin/main` | `bc718cc5c677ad0eb4598e7de3ad766473ff0847` | `4543971211ffaca302fb201ebe11a4a5fc7d6462` | expected value confirmed |
| `origin/integration/i1-c1-srv5-2026-09-16` | `23047b3bdc22842a5b17e29e3d3f603c0ee51b16` | `314b3a6db2989830ef9ea7659490f4eaa7c5b39b` | expected value confirmed |
| `origin/docs/roadmap-autonomy-correction-2026-09-18` | `6a48af8cd19137aaa10688c36cb064d3c4b16969` | `9963100b003b6cb11a09e4b97e50de0ef647adf` | expected value confirmed |

The correction branch was read directly at `origin/docs/roadmap-autonomy-correction-2026-09-18:docs/ROADMAP.md`. Its forward-only C3B insertion supersedes the provisional active-session-only policy without deleting historical C1/C2/C3A work.

### Local C3A object

The exact reported C3A candidate is present locally:

| Item | Exact value |
|---|---|
| C2 candidate | `6d40c33e32254e7fef0d1dfe36c3b38de60bfd29` |
| C2 tree | `639e6b1fdb0016fb60019ebac73702dd083bbb36` |
| C3A candidate | `a2adc0c5472ba955484f3774092b1da6754a0cd5` |
| C3A tree | `f076a63da0fd61b2cd0750a9320ac32a3e9e5bf2` |
| C3A parent | `6d40c33e32254e7fef0d1dfe36c3b38de60bfd29` |
| Ancestry | `git merge-base --is-ancestor C2 C3A` = 0 |
| Local ref | `refs/heads/feature/extension-i1-c2-3c1-r2-pretoken-plan-fence-2026-09-18` |
| C3B base | `a2adc0c5472ba955484f3774092b1da6754a0cd5` / `f076a63da0fd61b2cd0750a9320ac32a3e9e5bf2` |

The exact C2→C3A changed files are:

- `apps/extension/src/application/runtime.js`
- `packages/control-client/src/client.js`
- `packages/marketplaces/ozon/src/provider-runtime.js`
- `packages/marketplaces/wildberries/src/adapter.js`
- `tests/regression/extension-core/application.mjs`

The exact C3A object is not present on the fetched GitHub remote, but it is present and reachable through the local branch/ref and reflog. No source was reconstructed from memory. The bounded local branch created for this audit is `architecture/i1-c3b-autonomy-source-of-truth-2026-09-18`.

### Worktree boundary

Before the audit, the worktree contained unrelated untracked server directories, `repro/` evidence, and test fixtures. They were preserved and are not part of this artifact.

## 3. Product truth and authoritative documents

The audit treats the following as fixed constraints:

- `docs/roadmap-autonomy-correction-2026-09-18:docs/ROADMAP.md`, forward-only C2.3-C3B→C3H insertion;
- `docs/architecture/SYNC.md`, especially zero mandatory Seller Agents calls per ordinary command/delivery, extension-initiated sync, partition tolerance, and revision ordering;
- `docs/development/client-i1/C2_OFFLINE_POLICY_2026-09-16.md`, especially signed cache acquisition, effective-time floor, and `offlineGraceUntil` boundary;
- `docs/architecture/OVERVIEW.md`, `STATE_MACHINES.md`, `CONTRACTS.md`, and `DATA_AND_SECURITY.md`;
- `docs/development/ACCEPTANCE_MATRIX.md` and current C1/C2 evidence under `docs/migration/evidence/extension-i1-*`;
- current `AGENTS.md`, `docs/ROADMAP.md`, `docs/STATUS.md`, `docs/decisions/DECISIONS.md`, and `docs/decisions/OPEN_ITEMS.md`, read as current/local evidence but subordinate to the owner correction where they conflict.

The stale/current contradiction is material: current `docs/ROADMAP.md` and C2/C3A evidence describe bounded online-first or active continuation behavior, while the correction branch explicitly states that temporary control-server unavailability is not itself a Work denial. This report does not mark the old bounded steps erased or accepted under the corrected policy.

## 4. Current source-of-truth graph

### Authority layers actually present

| Layer | Current source and behavior | Audit result |
|---|---|---|
| Signed Bootstrap | `packages/control-client/src/client.js:548-584` verifies the cached envelope, computes the effective-time floor, and returns `FRESH` or `STALE_BUT_OFFLINE_GRACE_ELIGIBLE`; at/after grace it persists denial and throws `CACHE_EXPIRED`. | Valid cache foundation; not wired to autonomous Work. |
| Cache clock | `client.js:92-116`, owned by control/portal origin, contract, device, and session; effective time is monotone and persisted. | Keep and reuse. |
| Signed metadata projection | `signed-metadata.js` accepts `ONLINE`/`CACHE` and both non-expired freshness states; always `executionAuthority: false`. | Keep as projection, not authority alone. |
| Capability intersection | `capability-intersection.js` requires exact packaged capability plus exact signed BOOLEAN permission; always non-executing. | Keep as capability evidence. |
| Online Work authority | `online-work-authority.js` requires `bootstrap.source === ONLINE`, `freshness === FRESH`, `health PASS/current/verified`, and Start/Resume state gates. | Wrong as the sole admission source after correction. |
| Verified Health composition | `verified-online-work-authority.js` verifies a signed Health envelope against the Bootstrap/profile/context and feeds B2. | Health observation is coupled to admission today; must be separated. |
| Offline Work authority | `offline-work-authority.js` accepts only `CONTINUE`, active visible/hidden Work, matching online provenance, `authority.workAllowed`, and `safeTime < expiresAt`. | Replace/redesign; it encodes the superseded premise. |
| Application admission | `runtime.js:373-407`, `saWorkStart`, and `saWorkResume` perform online-only admission and mutate Work. | Rewrite boundary for C3C/C3D. |
| C3A command gate | `runtime.js:507-611` re-reads local context and calls the offline evaluator; provider fetches invoke it immediately before side effects. | Preserve fence concept, replace authority input. |
| Work state | `session-model.js` has inactive/pending/binding/active/recovering/finishing/error and revisioned local transitions. | Keep one state machine, extend admission provenance/state semantics. |
| Sync | No implementation of the documented multi-browser journal was found in the current source. | Later C3E/C3F; do not implement here. |

### Structural problem

`SellerAgentsControlClient.canWork()` calls `cacheAuthorizationCheckpoint()` and `currentWorkDecision()`, whose `authorityBaseValid()` is `effectiveTime < payload.expiresAt`. The client’s grace-aware `bootstrapWithPolicy()` is not called by `ensureForIdentity()` or by Start/Resume. `ensureForIdentity()` falls back to raw `bootstrap()` when the local authority decision is not already valid; raw Bootstrap has no offline cache fallback. Thus a server outage is converted into an admission denial before C1 can create local Work.

`saAdmitOnline()` then calls `acquireSignedHealthAuthority()` at `runtime.js:389`, so online Start, Resume, and store rebind require `/v1/health-authority`. The Health envelope is verified in memory and not persisted, but its PASS/current result is required by B2.

## 5. Complete flow map

Notation: `SA` is the control client; `H` is `/v1/health-authority`; `B` is `/v1/bootstrap`; `L` is local storage/state; `P` is Ozon/WB provider traffic. “Control call” means Seller Agents control-plane traffic, not marketplace traffic.

| Flow | Current call chain and authority dependencies | Current offline behavior / architectural problem |
|---|---|---|
| FLOW-01 New-dialogue Start, online | Popup `SA_WORK_START` → `saWorkStart` → tab identity → `SA.ensureForIdentity` → catalog read → `saAdmitOnline(start)` → `canWork`/authority snapshot → `H` → verified online B2 → pending Start → legacy `OZ_WORK_START` → local binding/session mutation → prompt send. Inputs include popup sender, tab id, store id, confirmation, intent id; sender URL is browser-trusted. | Works only with online FRESH Bootstrap and Health. New dialogue has no prior binding, but online authority gates it. Local store/catalog, pending Start, binding, Work revision, and prompt outcome are durable. |
| FLOW-02 Historical-dialogue Start, online | Same popup/application chain; identity is confirmed, existing binding/session is read; B2 Start allows inactive/error and validates binding/store/account/credential revision. | Works online. Historical identity/binding is used as context, not server proxy. Offline Start is denied by the same online-only path. |
| FLOW-03 Resume, online | Popup `SA_WORK_RESUME` → `saWorkResume` → identity/key equality → binding/store/work reads → `saAdmitOnline(resume)` → H → B2 Resume → legacy `OZ_WORK_RESUME` → local session/prompt recovery. | Works only with online FRESH Bootstrap + Health. Requires existing binding and inactive Work. Offline Resume is denied before local mutation. |
| FLOW-04 Store rebind, online | Popup selects a different local store → explicit confirmation → `saWorkStart` with changing store → rebind plan/fence → online B2 + H → local Finish of source → revision/fence check → new Start against target store. | Online-only. Current plan protects account/device/AI/binding/store/credential fields but is a C3A-era dependency that must be retained only as fencing, not as server reachability authority. |
| FLOW-05 Marketplace rebind, online | Marketplace UI changes selected catalog family; Start uses the selected store. A different store id is treated as changing store and requires confirmation; provider is selected from local store marketplace. | No separate marketplace-rebind authority object exists; it is folded into store rebind. Offline target selection cannot create the new context because `saWorkStart` requires online admission. |
| FLOW-06 Active Work continuation, server unavailable | Content command → `OZ_EXECUTE_COMMAND` → local `saAssertWorkAuthority` → `saGuard` → `saEvaluateDispatchAuthority` → local cache/provenance evaluation → provider guard → P. Delivery uses local owner/context checks. | May continue only while active visible/hidden, exact online admission provenance matches, credentials/store/context remain valid, and `safeTime < expiresAt`. It does not consume `offlineGraceUntil`; at `expiresAt` it denies even within grace. This is the surviving active-session-only privilege. |
| FLOW-07 New-dialogue Start, server unavailable | Same Start chain as FLOW-01. `ensureForIdentity` invokes raw B when `canWork` is false; B transport fails; `saAdmitOnline` is never reached. | Denied. This directly violates corrected `START-01` and `AUTH-01`. |
| FLOW-08 Historical Start, server unavailable | Same as FLOW-02; existing history/binding does not bypass `ensureForIdentity` or online admission. | Denied. A historical binding is treated as insufficient local authority. |
| FLOW-09 Resume, server unavailable | Same as FLOW-03; existing binding and inactive Work are read locally, then online admission/Health is required. | Denied. Existing local state does not authorize Resume. |
| FLOW-10 Store change, server unavailable | Popup catalog write is local; if Start/rebind follows, `saWorkStart` builds a local rebind plan but requires B2/H before Finish/target Start. | Catalog edit may persist, but Work rebind is denied or left unstarted. No coherent autonomous new Work context exists. |
| FLOW-11 Marketplace change, server unavailable | Selection is UI/local; target store is read from catalog; new binding is only made by Start/rebind. | Denied at Start/rebind; no autonomous explicit-confirmed target context. |
| FLOW-12 Ozon command predispatch | Content/manual request → `executeManualCommand`/batch queue → Ozon `createContext`/`saGuard` → `assertDispatchAuthority` → `OzonProvider.executeCommandObject` → `guardedFetch` → `P`. `assertCurrent` is checked before fetch. | Zero mandatory control call per command. Current gate is local but uses CONTINUE-only active/provenance authority. Provider side effect is fenced immediately before fetch. |
| FLOW-13 WB command predispatch | Content/manual request → WB context/adapter → `createProvider().execute` → adapter `guardedFetch` → `assertDispatchAuthority` then `assertCurrent` → `P`. | Zero mandatory control call per command. Same wrong C3A authority dependency; gate coverage is source-proven for provider fetch. |
| FLOW-14 Multi-command N→N+1 recheck | Batch queue persists current item/owner and invokes provider per item; each Ozon/WB provider request reaches the provider guard again. | Independent provider re-fence is present. If Work authority expires or context changes between N and N+1, later request denies. No automatic replay of an unknown provider outcome. |
| FLOW-15 Report START | Ozon report-create operation is normalized by `executeCommandObject`; `guardedFetch` applies the C3A gate immediately before provider request. Report session state is local. | No control call. Online/current active continuation only; offline autonomous report START from a new Work context is impossible. |
| FLOW-16 Report STATUS | Ozon report-info/status operation follows the same provider runtime and guarded fetch path; local report state may remember code policy. | No control call. Status is not a server archive, but current Work gate still blocks after `expiresAt`. |
| FLOW-17 Report DOWNLOAD | Ozon report-file reference is locally owned/expiry/store-fenced; `report_file_get` provider fetch still goes through Ozon guarded fetch. WB binary requests use the WB guarded fetch. | No control call. File ref is local and bounded; report download cannot survive a locally denied C3A authority. |
| FLOW-18 429/retry/quota resume | Provider returns Retry-After → local observed quota and batch become `quota_waiting`; C3A application patch disables automatic SA resume; explicit popup `SA_RESUME_QUOTA` checks local Work authority/context and relaunches the batch. | No control call. Automatic replay is not used; explicit resume re-fences before provider request. Current denial after `expiresAt` is still wrong for valid signed grace. |
| FLOW-19 Finish | Popup `OZ_WORK_FINISH` → admission cancellation/pending cancellation → legacy local Finish → session/binding visibility and delivery ownership close locally. | Server-independent and immediate. Finish must outrank late markers in later sync; current local stale revision/owner fencing helps, but no cross-browser marker model exists. |
| FLOW-20 Logout/reset/revoke/account/device/session change | `SA_AUTH_RESET` calls `localReset`, clears credentials/authority/cache clock, increments generation, invokes authority-change cleanup, finishes Work and clears pending Start. Refresh/bootstrap 401/403 invokes `invalidateKnown`; restore checks ownership/generation/context. | Known local reset/logout denies immediately. Local revoke is represented indirectly by missing credentials/authority; there is no independent local revoke record or server polling path. Device/account mismatch is fail-closed on restore/authority verification. |
| FLOW-21 Store deletion | Popup `SA_STORE_DELETE` → catalog remove → `saInvalidateStore` → cancel admissions, Finish bound sessions, clear store pending Starts. | Local and immediate. Existing Work tied to deleted store is closed; no cross-browser sync event exists. |
| FLOW-22 Credential revision change | `SA_STORE_SAVE` recomputes credential revision; changed revision or personal policy invokes `saInvalidateStore`, which cancels admissions/finishes Work/clears pending Start. Execution context compares credential revision before provider calls. | Local and immediate. Good safety fence; later autonomous model must retain it. |
| FLOW-23 Service-worker restart | Worker restore → local control state verification/cache checkpoint → persisted Work/manual operations/recovery read. Authority denial invokes cleanup. No server sync journal runs. | Persisted local state survives, but denied authority can finish Work. No offline Start/Resume after restart and no pending sync recovery. |
| FLOW-24 Browser restart | Same local restore path plus AI tab identity reacquisition. Existing local binding/session is not enough to admit a new action; provider delivery/recovery remains local. | Existing active local work may be recoverable only inside current authority constraints; no multi-installation sync or autonomous new Start. |
| FLOW-25 Server recovery/pending synchronization | No current `pending sync`, `baseRevision`, `requestId` journal or reconcile caller was found. A later user action may invoke online Bootstrap; no compact synchronization is emitted for local binding/delivery state. | Missing. This is C3E/C3F scope, not a C3B implementation. |
| FLOW-26 Late ACK/late delivery marker | No control-server ACK/delivery-marker path exists. Local owner id, delivery id, Work revision, binding/store/credential context, and `SellerAgentsExecutionContext` fence reject stale local events. | Local race fencing is present; cross-browser late ACK/marker semantics are UNKNOWN/MISSING. Explicit Finish/store change cannot yet be proven to outrank a remote marker because no remote marker exists. |

### Trusted versus caller-controlled inputs

Trusted inputs are browser-assigned sender URL/tab identity, verified signed Bootstrap/Health envelopes, packaged capability manifest, local storage readback, locally recomputed store credential revision, and live provider response metadata. Caller-controlled inputs include popup message fields (`store_id`, `conversation_key`, `confirm_change`, intent ids), content command text, `work_session_id`, manual request id, and any message-provided authority/provenance. Current code fences these against local state; C3C must not accept caller-supplied authority booleans or receipts as authority.

## 6. Server/control dependency matrix

| Dependency/read | Current classification | Current consumers | Corrected architecture |
|---|---|---|---|
| `/v1/device-authorizations` | `REQUIRED_ONLY_FOR_ONLINE_REFRESH` / authentication | Activation UI only | Keep for login; never Work admission. |
| Device authorization status polling | `REQUIRED_ONLY_FOR_ONLINE_REFRESH` | Activation polling | Keep bounded to activation; not Work. |
| `/v1/device-authorizations/token` | `REQUIRED_ONLY_FOR_ONLINE_REFRESH` | Activation exchange | Keep login only. |
| `/v1/auth/refresh` | `REQUIRED_ONLY_FOR_ONLINE_REFRESH` | Bootstrap credential freshness; recovery after Bootstrap 401 | Keep online auth refresh; outage must not deny valid local authority. |
| `/v1/bootstrap` | `REQUIRED_ONLY_FOR_ONLINE_REFRESH` when current local signed authority exists; currently a `WRONG_MANDATORY_ONLINE_DEPENDENCY` for Start/Resume | `ensureForIdentity`, explicit bootstrap, metadata/policy path | Keep as refresh/replacement source; use verified local cache/grace for Work. |
| `bootstrapWithPolicy()` cache path | `REQUIRED_ONLY_FOR_ONLINE_REFRESH` plus local authority read | Explicit metadata tests only; not current Work admission | Make its freshness result the shared Work authority input. |
| `offlineGraceUntil` / cache clock | `REQUIRED_FOR_SECURITY_AUTHORITY` local signed authority fact | Cache policy only; not current Work admission | Required for all autonomous Work decisions; equality/after denies. |
| `/v1/health-authority` | Current `WRONG_MANDATORY_ONLINE_DEPENDENCY` for Work admission; conceptually `HEALTH_OBSERVATION` | `saAdmitOnline` for Start/Resume/rebind | Keep optional observation producer; never persist/use as offline bearer or Work TTL. |
| `readVerifiedHealthMetadata` | `HEALTH_OBSERVATION` | Verified online B2 adapter; C3A does not call it | Keep detached verification; remove from autonomous authority decision. |
| B2 `SellerAgentsOnlineWorkAuthority` | Current `REQUIRED_FOR_ONLINE_AUTHORITY`; wrong as universal authority | Start/Resume/rebind | Redesign as one operation-neutral decision over local signed authority plus local safety; Health is optional observation. |
| `SellerAgentsControlClient.canWork()` | Local cache checkpoint, currently `WRONG_MANDATORY_ONLINE_DEPENDENCY` through raw Bootstrap fallback at caller | Start/Resume, dispatch, UI, delivery | Replace with a local authority evaluator that can return grace-eligible. |
| `getAuthority()` / `getCachedContinuationState()` | `REQUIRED_FOR_SECURITY_AUTHORITY` local reads | Admission/dispatch | Keep source of signed authority and invalidation facts; no server call. |
| signed metadata projection | `PRODUCT_METADATA` plus capability evidence | Composition/tests; not current Work | Keep read-only and feed the unified evaluator. |
| packaged capability manifest | `REQUIRED_FOR_SECURITY_AUTHORITY` local capability fact | Capability intersection | Keep immutable; cannot grant permission itself. |
| Store catalog/revision | Local `REQUIRED_FOR_SECURITY_AUTHORITY` context | Start/rebind, commands, reports, deletion | Keep; credential revision/store deletion are immediate local fences. |
| Manual operation/batch/delivery storage | Local lifecycle state, not control dependency | Commands, reports, 429, delivery | Keep local; never sync raw seller reports. |
| Provider Ozon/WB endpoints | Marketplace business traffic, not Seller Agents dependency | Ordinary commands/report lifecycle | Remain direct local provider calls; no control proxy. |
| Health envelope persistence | `LEGACY_OR_OBSOLETE_DEPENDENCY` if used as bearer | Not persisted by current client | Must remain non-persistent observation only. |
| B2 decision persistence | `LEGACY_OR_OBSOLETE_DEPENDENCY` if introduced | Not persisted | Do not add; recompute from local signed authority and local state. |
| Sync/reconcile endpoint | `UNKNOWN_NEEDS_REVIEW` because no client caller exists | None | Architect/C3E must define compact optional synchronization only. |

Invocation summary: Start/Resume/rebind currently invoke `canWork`, may invoke B, and invoke H. Ordinary command, report lifecycle, delivery, 429 resume, Finish, restart recovery, and current local cleanup invoke no mandatory Seller Agents network call. Current sync invokes none because it is missing.

## 7. Signed cache and offline-grace trace

### Proven current path

1. `client.js:587-631` calls online `bootstrapOnline()` first and falls back only for registered transport unavailability or the audited `503 BOOTSTRAP_UNAVAILABLE` case.
2. The cached envelope is reverified with the packaged trust bundle, canonical payload equality is checked, account/profile/environment/cache binding are checked, and the cache clock is validated.
3. `cachedBootstrapCheckpoint()` at `client.js:548-584` parses `expiresAt` and `offlineGraceUntil`, advances the nondecreasing effective-time floor, and computes:
   - `FRESH` when `effective < expiresAt`;
   - `STALE_BUT_OFFLINE_GRACE_ELIGIBLE` when `expiresAt <= effective < offlineGraceUntil`;
   - `CACHE_EXPIRED` when `effective >= offlineGraceUntil`, with durable `workAllowed: false` and denial persistence.
4. `signed-metadata.js` preserves `source: CACHE` and both accepted freshness values, while rejecting `CACHE_EXPIRED` because the client policy does not return it.
5. `capability-intersection.js` accepts both non-expired freshness values but keeps `executionAuthority: false`.

### Where the states are lost

- `canWork()`/`authorityBaseValid()` checks `expiresAt` only. It does not consume the `offlineGraceUntil` state from `bootstrapWithPolicy()`.
- `ensureForIdentity()` calls raw `bootstrap()` when current `canWork()` is false. Raw `bootstrap()` is online-only.
- `saAdmissionInput()` hardcodes `source: ONLINE`, `freshness: FRESH`.
- `online-work-authority.js` hardcodes online/FRESH and B2 Health PASS.
- `offline-work-authority.js` calls its expiry output `FRESH` versus `EXPIRED` and checks `safeTime >= expiresAt`; it never reads `offlineGraceUntil`.
- `saEvaluateDispatchAuthority()` sends `operation: CONTINUE`, and its post-evaluation fence rejects at `payload.expiresAt`.

The old C2 evaluator claims are therefore verified from source: only CONTINUE; only active visible/hidden; exact online admission provenance; denial at `expiresAt`; no consumption of `offlineGraceUntil`. The claim “does not make control calls during ordinary continuation” is also verified: C3A uses `getCachedContinuationState()` and `getVerifiedAuthorityTime()`, both local reads; the provider guard then performs only marketplace traffic.

## 8. Admission provenance audit

### Factual value today

`saAdmissionProvenanceSeed()` creates `seller_agents_online_admission_provenance_v1` with account, generation, device/session, Bootstrap digest/config/contract, AI/profile digest, marketplace/store/credential revision, conversation/binding/revision, Work intent, operation, and safe-time facts. It explicitly sets `executionAuthority: false` and `bearer: false`.

Useful non-authority facts are:

- historical audit of the admission event;
- stale callback and async admission fencing;
- account/device/session and signed-snapshot binding;
- AI/profile and store/credential context binding;
- binding revision and Work intent correlation;
- anti-replay/context mismatch evidence.

### Superseded semantics

`offline-work-authority.js` requires the persisted receipt to be present, identical to Work `admission_provenance`, `ONLINE_VERIFIED`, operation `START`/`RESUME`, and attached to active Work. That makes “this Work once started online” the reason offline operation is allowed. It also prevents new local Work and rebind by construction. The receipt is not a bearer cryptographically, but it is acting as a logical bearer credential.

### Classification

`admission_provenance`: `KEEP_AS_NON_AUTHORITY_EVIDENCE` plus `REDESIGN`. Split the historical lifecycle/audit record from the current authority decision input. Preserve context and race-fence fields where still useful; remove `ONLINE admission required`, `active session required`, and receipt-equality as prerequisites for autonomous Work. A historical receipt alone must never authorize Work.

## 9. Health/B2 coupling audit

`acquireSignedHealthAuthority()` in `client.js:383-394` performs a mandatory control request to `/v1/health-authority`, verifies the signed envelope, and checks it against the current signed Bootstrap/profile/device/session. `health-metadata.js:78-103` computes current observation validity from signed Health `expiresAt`, Bootstrap `expiresAt`, observation time, and the local verified authority clock. The result is detached and non-executing; it is not persisted in the control client.

`verified-online-work-authority.js` maps a verified Health PASS/current result into B2. `online-work-authority.js` then requires `health.status === PASS`, `current === true`, and `verified === true`. `saAdmitOnline()` calls this composition for Start, Resume, and rebind. Ordinary command dispatch does not acquire Health; it uses the local C3A evaluator.

Facts and boundaries:

1. A Seller Agents request is mandatory today for online Start/Resume/rebind, not for ordinary commands or delivery.
2. The Health envelope is not persisted by current source. Persisting it or a B2 decision as a new offline bearer would be a prohibited second authority system.
3. Health is currently required for new Work and not required for C3A continuation, creating inconsistent authority paths.
4. The extension source contains no autonomous Work timer derived from a 15-minute value. Server evidence describes a 15-minute Bootstrap observation/snapshot freshness; the corrected architecture must not turn that into Work TTL, dialogue TTL, grace TTL, or polling interval.
5. The exact boundary to change is the authority composition consumed by both admission and dispatch: it must accept the verified local signed Bootstrap authority and freshness/grace state plus local invalidation/context/capability facts. Health can remain an optional verified observation attached to diagnostics or online refresh, but not a required bearer.

Architect decision still required: whether “current local AI/profile observation” is a hard local safety condition for each Start/Resume/rebind or a separately versioned context fence. Either choice must use the same authority evaluator and must not introduce a third authority mechanism.

## 10. C3A command-gate audit

The exact C2→C3A diff is the five-file diff listed in §2. The gate source is proven in `runtime.js:507-627`, Ozon `provider-runtime.js:247-257`, and WB `adapter.js:137-151`.

| Reported claim | Result | Evidence |
|---|---|---|
| Ozon provider requests gated | `PROVEN` | C3A adds `guard.assertDispatchAuthority()` to Ozon `guardedFetch`, before `assertCurrent` and `fetch`. |
| WB provider requests gated | `PROVEN` | C3A adds `context.assertDispatchAuthority()` to WB `guardedFetch`, before `assertCurrent` and `fetchImpl`. |
| Zero mandatory Bootstrap per ordinary command | `PROVEN` | C3A reads cached local state; no `bootstrap()`/`bootstrapWithPolicy()` call in dispatch path. |
| Zero mandatory Health per ordinary command | `PROVEN` | Dispatch path calls no `acquireSignedHealthAuthority()`; focused C3A-01 also asserts no control-network growth. |
| Every multi-command item independently re-gated | `PROVEN_SOURCE; TEST_PARTIAL` | Batch/provider architecture reaches guarded fetch per provider request; C3A focused tests cover one request, not a dedicated N→N+1 authority mutation race. |
| Report START re-gated | `PROVEN_SOURCE; TEST_UNKNOWN` | Ozon report operations use the same `executeCommandObject`/`guardedFetch`; no focused report-specific C3A test found. |
| Report STATUS re-gated | `PROVEN_SOURCE; TEST_UNKNOWN` | Same provider path; no focused report-specific test. |
| Report DOWNLOAD re-gated | `PROVEN_SOURCE; TEST_UNKNOWN` | `report_file_get` uses guarded provider fetch and local file-ref owner; no focused report-specific C3A test. |
| 429/retry/quota resume re-gated before provider request | `PROVEN_SOURCE; TEST_PARTIAL` | Explicit quota resume relaunches the batch and provider fetch re-gates; APP-10 proves no early provider resume, but no dedicated C3A re-fence test. |
| No automatic replay of UNKNOWN provider outcome | `PROVEN` | Existing queue/delivery policy and C3A application regressions preserve no-retry semantics; C3A gate itself has no replay path. |
| Delivery is not a control-server dependency | `PROVEN_SOURCE` | Delivery owner/context checks use local storage and `saAssertWorkAuthority`; no control call in delivery. |
| Gate is bound to C2 active-session-only authority | `PROVEN` | `saEvaluateDispatchAuthority` passes CONTINUE, active Work, matching online receipt, authority `workAllowed`, and expiresAt-only fence to `SellerAgentsOfflineWorkAuthority`. |

Classification: `KEEP_GATE_REPLACE_AUTHORITY_DEPENDENCY`. The just-before-provider fence, local context re-read, per-request invocation, and no-replay behavior are valuable. The evaluator input and active-session/provenance requirement must be replaced as part of the one authority rewrite. No obsolete wrong evaluator should remain as fallback.

## 11. Sync, binding, and multi-browser audit

### Current local pieces

| Required concept | Classification | Evidence/current state |
|---|---|---|
| `bindingRevision` | `PRESENT_BUT_WRONG` for global sync / `ALREADY_PRESENT_AND_USABLE` as local fence | Local binding `revision` is persisted and included in Work context/provenance; no server revision/reconcile record. |
| Binding id/store/credential revision | `ALREADY_PRESENT_AND_USABLE` locally | Catalog and application context checks fence account/store/marketplace/credential revision. |
| Preferred installation/executor | `MISSING_FOR_C3E` | No `preferredExecutor` source implementation found. |
| Last-delivered marker | `MISSING_FOR_C3F` | No `lastDelivered`/`last_delivered` sync marker implementation found. |
| `baseRevision` | `MISSING_FOR_C3E` | Only docs/tests/other unrelated revision concepts; no sync journal. |
| `requestId` | `PRESENT_BUT_WRONG` for sync | Provider/request/delivery ids exist, but no idempotent sync operation journal. |
| Pending sync operations | `MISSING_FOR_C3E` | No pending-sync store or caller. |
| Bounded retry/backoff/jitter | `MISSING_FOR_C3E` | Provider quota backoff exists; no sync retry scheduler. |
| Dirty compact snapshot | `MISSING_FOR_C3E` | Local state exists, but no sync projection/journal. |
| ACK compaction | `MISSING_FOR_C3E` | No sync ACK path. |
| Duplicate sync request id | `MISSING_FOR_C3E` | Device-auth idempotency is unrelated to Work sync. |
| Late ACK/delivery ordering | `PARTIAL`, then `MISSING_FOR_C3F` | Local Work revision and delivery owner fences exist; no cross-browser late-event precedence. |
| Store change/Finish local ordering | `ALREADY_PRESENT_AND_USABLE` locally | Finish/store deletion/revision cancellation and stale local transition checks exist. |
| Disconnected installation | `MISSING_FOR_C3F` | No partition reconcile state. |
| Clock skew | `PARTIAL` | Signed cache effective-time floor is strong; no sync event ordering model. |

No C3E/C3F implementation is included in this task.

## 12. KEEP / REDESIGN / REPLACE / REMOVE matrix

| Component/function | Classification | Source evidence and reason | Corrected responsibility / later step |
|---|---|---|---|
| Verified cached Bootstrap acquisition | `KEEP` | `client.js:587-631`, `C2_OFFLINE_POLICY`; real signature/cache/transport/clock checks. | Installation-local signed authority source; C3C. |
| Cache clock / safe-time floor | `KEEP` | `client.js:92-116`, persisted monotone floor. | Security time floor for FRESH/grace/expired; C3C. |
| Signed metadata projection | `KEEP` | `signed-metadata.js`, executionAuthority false. | Read-only signed configuration/profile evidence; C3C/C3D. |
| Capability intersection | `KEEP` | `capability-intersection.js`, exact package/signed intersection. | Capability evidence only; C3C/C3D. |
| Online Work authority | `REPLACE` | Hardcodes online/FRESH and Health. | One operation-neutral evaluator over local signed authority and local safety; C3C. |
| Verified Health composition | `REDESIGN` | `verified-online-work-authority.js` feeds B2 admission. | Optional observation producer; not bearer/TTL; C3C. |
| C1 Start admission | `REPLACE` | `saWorkStart` → `saAdmitOnline` → H. | Same authority evaluator admits online/autonomous Start; C3C/C3D. |
| C1 Resume admission | `REPLACE` | `saWorkResume` → `saAdmitOnline` → H. | Same evaluator, inactive-bound context and explicit Resume; C3C/C3D. |
| Rebind plan/fencing | `KEEP` then `REDESIGN` | `saRebindPlan`, `saValidateRebindPlan`, finish-before-target fences are useful. | Context/race fence independent of online authority; autonomous rebind; C3D. |
| Admission epoch/race fencing | `KEEP` | `saAdmissionEpochs`, cancellation, same-fence checks. | Apply to unified authority and local mutations; C3C/C3D. |
| `admission_provenance` | `KEEP_AS_NON_AUTHORITY_EVIDENCE` + `REDESIGN` | Exact receipt is currently required by offline evaluator. | Historical/audit/race record only; C3C. |
| Current offline-work-authority | `REPLACE` | CONTINUE-only, active-only, receipt-only, expiresAt-only. | Unified autonomous evaluator for Start/Resume/rebind/Continue; C3C. |
| Work session state machine | `KEEP` + `REDESIGN` | `session-model.js` has revisioned transitions and local Finish/error handling. | One state machine with autonomous admission/context fields; C3C/C3D. |
| Pending Start state | `KEEP` + `REDESIGN` | Durable readback and no-retry send semantics in service worker. | Permit autonomous pending Start and preserve restart safety; C3D. |
| Binding state | `KEEP` + `REDESIGN` | Local binding/store context is fenced but no global revision. | Local authority/context now; sync projection later; C3D/C3E. |
| Store/credential revision fences | `KEEP` | Catalog revision and provider context checks. | Immediate local invalidation; C3D. |
| Ordinary command gate | `KEEP_GATE_REPLACE_AUTHORITY_DEPENDENCY` | C3A provider boundary is correctly placed. | Consume unified authority with zero control calls; C3G. |
| Report lifecycle gate | `KEEP_GATE_REPLACE_AUTHORITY_DEPENDENCY` | Ozon guarded fetch covers provider report paths. | Same unified authority, per request; C3G. |
| 429 gate | `KEEP_GATE_REPLACE_AUTHORITY_DEPENDENCY` | Local observed quota/explicit resume/no automatic retry. | Re-fence unified authority before provider retry; C3G. |
| Delivery gate | `KEEP` + `REDESIGN` | Local owner/context/send commit fencing is useful. | Unified authority + local binding revision; C3G/C3F. |
| Synchronization state | `MOVE_TO_LATER_C3E` | No current journal; docs define compact optional sync. | Extension-originated pending metadata and bounded reconcile; C3E. |
| Multi-browser markers | `MOVE_TO_LATER_C3F` | No preferred executor/last-delivered implementation. | Revisioned convergence and late-event precedence; C3F. |

No component is retained as an authoritative fallback for the superseded active-session-only path.

## 13. Replacement architecture candidate for architect review

This is a candidate, not self-acceptance.

### A. Installation-local signed autonomous authority

Define one pure authority evaluator. Its input is the latest locally verified signed Bootstrap envelope plus the owned cache clock, with freshness explicitly represented as `FRESH`, `STALE_BUT_OFFLINE_GRACE_ELIGIBLE`, or `CACHE_EXPIRED`. `CACHE_EXPIRED` denies. Grace is bounded by the signed `offlineGraceUntil`; the client may not extend it. Online refresh can replace the snapshot but is not required for ordinary Work while the current snapshot remains valid.

### B. Local invalidation and identity

Logout, reset, known revoke, account mismatch, device/session mismatch, store deletion, and credential revision mismatch are local denial facts with immediate generation/context fencing. An authority result cannot become valid merely because an old Work receipt matches. Persist only safe invalidation/context metadata, not raw Health/B2 envelopes.

### C. Capability authority

Use the exact signed permission plus packaged capability intersection. It proves that the selected marketplace and AI adapters are permitted/present; it does not manufacture execution authority. The unified evaluator consumes capability evidence but keeps provider execution in the local command/context layer.

### D. AI/profile/Health separation

- Signed Bootstrap owns account/config/profile authority and exact account/device/session/AI scope.
- Local AI/dialogue observation owns current page identity and conversation context.
- Health is a verified producer observation, optionally refreshed online and never persisted as a bearer. Its observation freshness must not become Work/dialogue/autonomous-operation TTL or a polling interval.

### E. Work admission

Online Start, autonomous Start, historical Start, Resume, and explicit store/marketplace rebind all call the same evaluator with an operation enum and the same authority/context layers. The operation changes state-machine preconditions and user confirmation, not the source of authority. New dialogue has no binding but does have a verified page identity and selected local store; historical Start/Resume use existing binding and revisions. Rebind creates a new binding/context revision after explicit confirmation and local source Finish/fencing.

### F. Work continuation

Continuation consumes the same local signed authority, invalidation, capability, store/credential, dialogue, binding, and Work state facts. Active state is a lifecycle condition, not the reason authority exists. A prior online receipt may remain evidence but never grants the only permission.

### G. Command predispatch

Retain the Ozon/WB just-before-provider local fence. It must re-read the current unified authority/context before every provider request, with zero mandatory Seller Agents calls. N→N+1, reports, 429 resume, and delivery continue to use local context and no provider replay of unknown outcomes.

### H. Synchronization boundary

Local authority and local Work remain usable before ACK. C3E later adds only compact extension-originated metadata with `baseRevision`, idempotent `requestId`, bounded retry/backoff, dirty snapshots, and ACK compaction. It must not become live Work admission or a raw report archive.

### I. Multi-browser

Each installation holds local authority, Work, credentials, and local context. Browsers may diverge during partition. C3F later reconciles binding revisions and compact last-delivered/preferred-executor markers. Explicit Finish/store change/new binding revision wins over late markers; last-delivered competes only inside the same valid binding/store context. Unknown disconnected installations remain unknown, not falsely revoked.

## 14. Later-step invariants

| ID | Invariant to consume in C3C–C3H |
|---|---|
| AUTH-01 | Server reachability alone never denies otherwise-valid local autonomous Work. |
| AUTH-02 | `CACHE_EXPIRED` denies. |
| AUTH-03 | `STALE_BUT_OFFLINE_GRACE_ELIGIBLE` remains distinct from expired and uses the signed grace boundary. |
| AUTH-04 | Known local logout/reset/revocation/account/device/session mismatch denies immediately. |
| AUTH-05 | No locally invented capability permission. |
| AUTH-06 | An old online-admission receipt is insufficient by itself. |
| AUTH-07 | No raw Health/B2 persisted bearer. |
| START-01 | Corrected local authority may admit new Start during server outage. |
| RESUME-01 | Corrected local authority may admit Resume during outage. |
| REBIND-01 | Explicit-confirmed store/marketplace rebind may be admitted during outage with a new Work context. |
| CMD-01 | Ordinary command adds zero mandatory control calls. |
| CMD-02 | Every provider request re-fences current local authority/context. |
| SYNC-01 | Sync failure is isolated from ordinary local Work. |
| MB-01 | Two browsers may diverge temporarily. |
| MB-02 | Late delivery cannot undo Finish/store change/new binding revision. |
| HEALTH-01 | 15-minute Health observation freshness is not autonomous Work TTL. |
| PRIV-01 | No raw seller report/server archive. |
| PRIV-02 | No marketplace token persists server-side. |
| RACE-01 | A stale positive admission result cannot mutate after Finish, reset, store deletion, credential revision, or newer binding revision. |
| RACE-02 | Clock rollback cannot reopen expired grace or regress the safe-time floor. |
| CAP-01 | Signed permission and packaged capability must both be present for the selected marketplace and AI. |
| CONTEXT-01 | Caller-supplied authority/provenance booleans are never trusted. |
| DELIVERY-01 | Delivery ownership is local and context-bound; Seller Agents availability is not a delivery prerequisite. |

## 15. Test impact map

No tests were changed. The following is the required later impact.

| Existing suite/coverage | Classification | Reason |
|---|---|---|
| `client-offline-policy.mjs` cache transport, signature, clock, durable denial, grace equality/after | `KEEP` | These security/cache invariants remain valid. |
| `client-signed-metadata.mjs` stale metadata projection with `executionAuthority: false` | `KEEP` | Correctly proves distinct metadata freshness and non-authority. |
| `client-cache-time.mjs` monotone floor/restart rollback | `KEEP` | Safe-time security remains required. |
| `client-c2-3a-online-work-authority.mjs` online B2 gate tests | `UPDATE` | Preserve online identity/capability/context/Health observation tests; remove online/FRESH as universal Work policy. |
| `client-c2-3a-online-work-authority.mjs` stale-cache-denies-as-Work-policy cases | `DELETE_AS_WRONG_POLICY_TEST` or rewrite | Stale grace must not be immediate universal denial. Preserve `CACHE_EXPIRED` denial tests. |
| `client-c2-3c1-online-work-admission.mjs` Health network failure denies Start/Resume | `DELETE_AS_WRONG_POLICY_TEST` or rewrite | Control outage is not itself Work denial. Preserve malformed/tampered/context/race denial tests. |
| `client-c2-3c2-offline-continuation.mjs` / `browser_c2_offline_continuation.py` active-only/provenance-only acceptance | `UPDATE` plus `DELETE_AS_WRONG_POLICY_TEST` for policy assertions | Security/fence cases survive; “only already-active Work” must not survive as product acceptance. |
| `application.mjs` C3A-01 zero control call | `KEEP` | Ordinary command transport invariant. |
| `application.mjs` C3A-02 missing provenance denies | `UPDATE` | Missing/invalid context evidence can deny, but a historical receipt must not be required as sole authority. |
| `application.mjs` C3A-03 hidden Work denies | `KEEP` | UI/lifecycle state may still deny provider dispatch when hidden, subject to architect state choice. |
| `application.mjs` C3A-04 Finish/crypto race | `KEEP` | Stale-positive race invariant remains. |
| Existing APP-10 quota/no-auto-retry | `KEEP` + later `NEW_C3G_TEST` | Preserve quota and no replay; add autonomous-authority re-fence. |
| New outage before new dialogue | `NEW_C3C_TEST` / `NEW_C3D_TEST` | Corrected local Start. |
| Historical Start/Resume outage | `NEW_C3D_TEST` | Corrected local admission. |
| Store/marketplace rebind outage | `NEW_C3D_TEST` | Explicit confirmation and new binding context. |
| Service-worker/browser restart during grace | `NEW_C3D_TEST` | Local authority survives restart without Health bearer. |
| Ordinary command/report Ozon/WB under autonomous Start | `NEW_C3G_TEST` | Gate consumes corrected authority with zero control calls. |
| N→N+1/retry/report re-fence | `NEW_C3G_TEST` | Provider-boundary races. |
| Compact pending sync/requestId/baseRevision/ACK | `NEW_C3E_TEST` | Later sync only. |
| Two browser divergence/late delivery/preferred executor | `NEW_C3F_TEST` | Later reconciliation only. |
| Full signed grace/revocation/provider/delivery/restart matrix | `C3H_END_TO_END` | Must run source and packaged runtime; live provider calls remain zero. |

The current C2/C3A green tests are baseline evidence for the implemented old policy, not proof that the old policy is product-correct.

## 16. Unresolved evidence gaps and discrepancy batch

1. The exact C3A object is available locally, so its five-file diff and source claims are provable; no remote publication exists for that object.
2. No dedicated C3A report START/STATUS/DOWNLOAD test was found; source path proves the guard, test result is marked partial/unknown above.
3. No dedicated C3A N→N+1 authority mutation race test was found; source path is proven, focused test coverage is partial.
4. No current sync implementation, server reconcile caller, pending sync journal, `baseRevision`, preferred executor, or last-delivered marker was found. All multi-browser conclusions beyond local fencing are evidence gaps and later C3E/C3F scope.
5. Current local invalidation exposes logout/reset through missing credentials/authority, but there is no distinct persisted local revoke record. Known server revocation is handled when an auth/bootstrap failure is observed; disconnected revocation detection is necessarily unknown until a refresh/reconcile event.
6. The current source does not contain a 15-minute Work timer; the 15-minute value comes from Health/Bootstrap server policy evidence and must remain observation freshness only.
7. Current `docs/STATUS.md` and older C2/C3A evidence describe bounded historical statuses; this report does not update or reinterpret them as accepted C3B/C3C work.
8. The prescribed test environment is unavailable: Node `v12.22.9` cannot parse the repository’s optional chaining. A Node >=24 runtime is required by `package.json`; no credentials or provider calls were introduced to compensate.

## 17. Baseline validation

| Check | Result |
|---|---|
| `git fetch origin --prune` | PASS |
| C3A object/ancestry/tree verification | PASS |
| C2→C3A exact changed-file enumeration | PASS |
| `python3 tooling/checks/extension_i1.py --output /tmp/sa-c3b-i1-check-20260918` | BLOCKED/FAIL before tests: Node `v12.22.9`, syntax error on optional chaining in composed `attachment_delivery_port_content.js`; no product test result claimed |
| C2 offline focused suite | IDENTIFIED as `tests/regression/extension-core/client-i1/client-offline-policy.mjs`; not executed independently because the same Node v12 syntax gate blocks composition/checker |
| C3A focused suite | Identified as C3A additions in `tests/regression/extension-core/application.mjs` (`C3A-01`…`C3A-04`); not executed independently because the same Node v12 syntax gate blocks composed runtime |
| `pnpm docs:check` | Pending until artifact exists; run after this document is created |
| `git diff --check` | Pending until artifact is created |
| Marketplace/provider calls | NONE |

## 18. No-production-code-changed attestation

The C3B work changed no production runtime, provider, control client, bridge-core implementation, test, migration, contract, OpenAPI, or STATUS file. The only intended tracked change is this audit document. Unrelated pre-existing untracked files were not erased or modified.

## 19. Deferred ledger

- `OWNER_DEFERRED_TEST-I1-ONLINE-WORK-HEALTH-20260917` — preserved.
- `PROVISIONAL_OWNER_REVIEW-HEALTH-TTL-20260917` — preserved.
- `PROVISIONAL_OWNER_REVIEW-OFFLINE-ACTIVE-CONTINUATION-20260918 = SUPERSEDED_BY_OWNER` — recorded as superseded by the owner correction.
- `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION` — applies: remote publication is not required and no authenticated publication route was used.

## 20. Recommended C3C inputs (facts only)

- Replace the `CONTINUE`/active/provenance-only evaluator contract and the online-only admission composition with one operation-neutral local signed-authority evaluator.
- Reuse the verified Bootstrap envelope, cache clock, exact capability intersection, local invalidation, store/credential revision, binding, AI identity, and Work revision fences.
- Consume `STALE_BUT_OFFLINE_GRACE_ELIGIBLE` through signed `offlineGraceUntil`; deny only at `CACHE_EXPIRED` or a known local safety invalidation.
- Keep Health detached/non-persistent and non-authoritative for autonomous admission.
- Preserve Ozon/WB per-request dispatch fences, no mandatory control calls, quota wait/no-replay, local delivery ownership, and race cancellation.
- Treat `admission_provenance` as non-authority lifecycle evidence; do not retain active-session-only logic as fallback.
- Carry the missing sync fields and multi-browser ordering into C3E/C3F design, not into a C3B workaround.

**C3B stop boundary:** no C3C implementation, offline Start/Resume/rebind implementation, sync implementation, command-gate rewrite, provider replay, or joint offline command/result recovery is started by this audit.
