# C2.3-C3H — Corrected autonomy full acceptance

Work ID: `SA-I1-C2-3-C3H-CORRECTED-AUTONOMY-FULL-ACCEPTANCE-20260918-01`

Status: `C3H_AUTOMATED_ACCEPTANCE_READY_WITH_BROWSER_FAMILY_DEFERRED`.
This is an implementation-candidate receipt, not architect acceptance. The
architect must make the final acceptance decision.

## Candidate identity and lineage

Normal `git fetch origin` completed without force, reset, rebase, amend, or
merge. The requested refs were present:

| Ref | Commit | Tree |
|---|---|---|
| `origin/main` | `bc718cc5c677ad0eb4598e7de3ad766473ff0847` | `4543971211ffaca302fb201ebe11a4a5fc7d6462` |
| `origin/integration/i1-c1-srv5-2026-09-16` | `23047b3bdc22842a5b17e29e3d3f603c0ee51b16` | `314b3a6db2989830ef9ea7659490f4eaa7c5b39b` |
| `origin/docs/roadmap-autonomy-correction-2026-09-18` | `6a48af8cd19137aaa10688c36cb064d3c4b16969` | `9963100b003b6cb11a09e4b97e50de0ef647adf` |

The accepted correction lineage is preserved as:

`C3A a2adc0c5472ba955484f3774092b1da6754a0cd5`
(`f076a63da0fd61b2cd0750a9320ac32a3e9e5bf2`)
→ `C3B ed32fc19fc14ed18b7392f4a2d60c95d85e02773`
(`49c13d0a3de590a566dc51bc35cc215afc5fa6f0`)
→ `C3C 5c87191fcd8dbc07ae6adf7839d92cc78e4c0736`
(`58ecd72b35d48b984ac560967e37bab97a2365d7`)
→ `C3D d91aa7095c84dead059beb5ea74662f59cd15311`
(`b6ee656f4e2209b3e80363246d7b9a93ddf259d5`)
→ `C3E 2b2ca0cdd322b0b180ee348fd9d5deb54141a487`
(`167beb9d98f720f3836a89d51de411defe3d5e08`)
→ `C3E-R1 28094153c49e7296140fe2368837c92571e2ba18`
(`13c9fe707590b9a0c2afdfc03e8f835ba03e98f7`)
→ `C3F eeb943fea402ff6cd5b97e72669de51e33dc2579`
(`3993d0129c40f636935948dc219b4a720899848a`)
→ `C3G b8639fc0e3075f45d399bd078d7a3c62c335dab1`
(`a231fea2b95f4d41672d43d97e3daf91bff19a91`).

C3H was branched at the exact C3G candidate above. The C3H implementation
commit is `21d0b6331d766bf742abb108e0086078e45c8eaf`, tree
`486e429b51ee86099ad6065da013bb9a8722f6c9`. The final evidence/documentation
commit is the next commit on this branch; its exact HEAD/tree is recorded in
the terminal report.

## Integrated harness

`tests/regression/extension-core/client-i1/client-c3h-corrected-autonomy-full-acceptance.mjs`
is one coherent harness. It composes signed local authority, two synthetic
installations, dialogue/store bindings, Ozon and Wildberries fixtures,
provider dispatch, the C3E journal wire shape, a partitionable `/v1/sync`
boundary, recovery, reconciliation, invalidation, restart, and privacy
assertions. Ordinary provider traffic uses local fixture fetches and never
passes through Seller Agents control admission. A browser-proof environment
variable is accepted only for the separately recorded real-unpacked Chromium
run; without that evidence AUT-47 remains DEFERRED.

## AUT-01 through AUT-50

The source and extracted C3H harness runs are PASS with the browser proof
combined below. `C3H-JSON` means the harness JSON result; `C3G/C3F` means the
preserved corrected predispatch/reconciliation gates; `PG` means the real
PostgreSQL `/v1/sync` gate; `BR` means the real unpacked Playwright Chromium
run.

| AUT | Result | Evidence |
|---|---|---|
| AUT-01 | PASS | C3H-JSON: offline new dialogue |
| AUT-02 | PASS | C3H-JSON: signed local Start |
| AUT-03 | PASS | C3H-JSON: historical Start |
| AUT-04 | PASS | C3H-JSON: offline Resume |
| AUT-05 | PASS | C3H-JSON: store rebind warning/context |
| AUT-06 | PASS | C3H-JSON: marketplace rebind warning/context |
| AUT-07 | PASS | C3H-JSON: multiple stores |
| AUT-08 | PASS | C3H-JSON: dialogue isolation |
| AUT-09 | PASS | C3H-JSON: two installations |
| AUT-10 | PASS | C3H-JSON: Ozon and WB |
| AUT-11 | PASS | C3H-JSON: worker reconstruction |
| AUT-12 | PASS | C3H-JSON: durable runtime restart |
| AUT-13 | PASS | C3H-JSON/C3G: ordinary Ozon command |
| AUT-14 | PASS | C3H-JSON: report START |
| AUT-15 | PASS | C3H-JSON: report STATUS |
| AUT-16 | PASS | C3H-JSON: report DOWNLOAD |
| AUT-17 | PASS | C3H-JSON: FRESH |
| AUT-18 | PASS | C3H-JSON: offline grace |
| AUT-19 | PASS | C3H-JSON: exact grace equality denial |
| AUT-20 | PASS | C3H-JSON: expired cache denial |
| AUT-21 | PASS | C3H-JSON: logout invalidation |
| AUT-22 | PASS | C3H-JSON: local auth reset |
| AUT-23 | PASS | C3H-JSON: known revocation |
| AUT-24 | PASS | C3H-JSON: account mismatch |
| AUT-25 | PASS | C3H-JSON: device/session mismatch |
| AUT-26 | PASS | C3H-JSON/C3G: credential revision fence |
| AUT-27 | PASS | C3H-JSON/C3G: store deletion fence |
| AUT-28 | PASS | C3H-JSON: local Finish |
| AUT-29 | PASS | C3H-JSON: historical command inertness |
| AUT-30 | PASS | C3H-JSON/C3E: recovery without Work blocking |
| AUT-31 | PASS | C3H-JSON/PG: duplicate request idempotency |
| AUT-32 | PASS | C3H-JSON: bounded retry state |
| AUT-33 | PASS | C3H-JSON/C3F: late ACK fence |
| AUT-34 | PASS | C3H-JSON/C3F: Finish outranks delivery |
| AUT-35 | PASS | C3H-JSON/C3F: store change outranks delivery |
| AUT-36 | PASS | C3H-JSON/C3F: eligible last-delivered comparison |
| AUT-37 | PASS | C3H-JSON/C3F: stable preferred executor |
| AUT-38 | PASS | C3H-JSON: clock skew fence |
| AUT-39 | PASS | C3H-JSON/C3F: disconnected UNKNOWN |
| AUT-40 | PASS | C3H-JSON/PG: no raw seller report |
| AUT-41 | PASS | C3H-JSON/PG: no marketplace token |
| AUT-42 | PASS | C3H-JSON/C3G: zero command control calls |
| AUT-43 | PASS | C3H-JSON/C3G: zero delivery control calls |
| AUT-44 | PASS | C3H-JSON: no periodic Health dependency |
| AUT-45 | PASS | C3H-JSON: Health freshness/grace separation |
| AUT-46 | PASS | source/package/composed parity and 39-file package |
| AUT-47 | PASS | BR: source and extracted actual unpacked Chromium |
| AUT-48 | PASS | C3H-JSON/C3F: post-recovery isolation |
| AUT-49 | PASS | C3H-JSON/C3G: UNKNOWN provider count remains one |
| AUT-50 | PASS | C3H-JSON/C3G: online regression |

AUT-47 is PASS for Playwright-managed Chromium. The system Google Chrome route
was attempted and timed out waiting for MV3 `serviceworker`; that separate
route is `ENVIRONMENT_DEFERRED_NATIVE_MV3_REGISTRATION`, not a Google Chrome
PASS claim. Other browser families remain unverified.

## Failure batch and fixes

The initial complete reachable batch found no product/source regression. It
found seven C3H fixture assertions: report fixtures lacked synthetic
performance credentials (AUT-14–16), authority restoration made AUT-20 and
AUT-22 test the wrong state, AUT-32 inherited the previous online mode, and
AUT-38 patched the wrong clock field. The harness was corrected together at
the fixture/evaluator boundary. No production authority, provider, Health,
sync, or reconciliation bypass was added.

The existing APP-05 timing-sensitive assertion (`application.mjs:193`, one
provider call observed instead of two) reproduced on the untouched C3F base:
9/10 repeated runs passed and 1/10 failed. The candidate’s standalone APP-05
run was 10/10. Two fresh full-checker runs also hit the same assertion before
the checker could reach later gates. This is classified
`PREEXISTING_TEST_HARNESS_FLAKE`, not `C3G_PRODUCTION_REGRESSION` or
`C3H_PRODUCTION_REGRESSION`; no retry, timeout increase, assertion removal, or
checker bypass was used. A separate complete post-fix checker run reached
`132` gate processes PASS.

## Authority, lifecycle, provider, and sync evidence

- Authority states are `FRESH` for effective time before `expiresAt`,
  `STALE_BUT_OFFLINE_GRACE_ELIGIBLE` for the half-open interval from
  `expiresAt` through before `offlineGraceUntil`, and `CACHE_EXPIRED` at or
  after exact `offlineGraceUntil`. Exact equality denies.
- New and historical Start, Resume, store/marketplace rebind, Finish, worker
  reconstruction, local invalidation, Ozon, WB, report lifecycle,
  multi-command and 429 suites remain green in the C3H/C3G regression set.
- C3H pending journal recovery uses six metadata sync requests in the
  synthetic boundary; they are independent of the provider critical path.
  Sync/reconciliation caused zero provider calls, zero prompts, and zero
  result replays. UNKNOWN provider work remained exactly one provider request.
- Mandatory control-call deltas were exactly zero for ordinary Ozon, ordinary
  WB, multi-command, report START, report STATUS, report DOWNLOAD, 429 retry,
  and ordinary result delivery. Background synchronization is separately
  observable and was not globally disabled.
- Health observation age is not Work TTL. No periodic Health fetch is needed
  to preserve signed grace, and no raw Health envelope is used as bearer
  authority.

## PostgreSQL and server regression

Task-owned ephemeral Docker `postgres:18.0` was used on loopback with synthetic
credentials and no persistent volume. The real migration chain through 0017,
real Fastify `/v1/sync`, authentication, duplicate request idempotency,
conflicts, stale-base handling, bounds, rollback/concurrency and schema
privacy checks passed: `sync.integration.test.ts` 6/6. Sync/reconciliation
unit and migration tests passed 11/11. Actual database inspection confirmed
compact allowlisted rows with no report, token, conversation, raw payload,
authorization header, report bytes, AI body, storageState, or Health envelope
columns/values. The container was stopped after testing.

## Browser and package evidence

- Node: `/root/.nvm/versions/node/v24.20.0/bin/node`, v24.20.0.
- pnpm: Corepack pnpm 10.34.5 executable.
- System Chrome: Google Chrome 147.0.7727.116, native MV3 registration
  environment-deferred.
- Playwright Chromium: 151.0.7922.34. Actual unpacked source and extracted
  extension runs each passed BR-C1-01 through BR-C1-36, including service
  worker activation, storage/runtime, restart and fixture dispatch. This is
  `REAL_UNPACKED_CHROMIUM_PASS`; it is not `GOOGLE_CHROME_PASS`.
- Package version: `0.2.4`.
- Package: `/tmp/c3h-package-a-5MF1xv/output/SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`.
- Size: 1,955,193 bytes. SHA-256:
  `e45801f83e66dfc3e7cc6fb372f77b6d9a309db498f7fcded1d5c77cecd178ef`.
- Runtime files: 39. Extracted files: 39. Two clean builds produced equal
  ZIP bytes and equal runtime manifests; the build receipt also verified
  source-to-extracted bytes.
- No production credentials, private signing key, marketplace request, raw
  report, report file, AI message, storageState, session secret, or raw Health
  envelope was committed or retained as C3H evidence.

## Stream 2 boundary and ledger

Stream-2-owned production files changed: none. No files under
`apps/health-runner/**`, `packages/server/health/**`, or `tooling/api-watch/**`
were modified. The consumed Health interface was tested only for observation
freshness versus signed Work grace. No parallel-stream dependency was found.

Preserved ledger:

- `OWNER_DEFERRED_TEST-I1-ONLINE-WORK-HEALTH-20260917`
- `PROVISIONAL_OWNER_REVIEW-HEALTH-TTL-20260917` — 15 minutes remains Health
  observation freshness only.
- `PROVISIONAL_OWNER_REVIEW-OFFLINE-ACTIVE-CONTINUATION-20260918` —
  `SUPERSEDED_BY_OWNER`.
- `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`.
- `PREEXISTING_DOCS_CHECK_FAILURES`.
- `ENVIRONMENT_DEFERRED_NATIVE_MV3_REGISTRATION` for system Chrome only;
  Chromium-family proof is closed through Playwright Chromium.
- `OWNED_BY_PARALLEL_STREAM_2` — no new item.
- APP-05 — `PREEXISTING_TEST_HARNESS_FLAKE`.

## Recommendation and stop boundary

The corrected active-session-only dependency is absent from the authoritative
provider path. The integrated evidence supports `ACCEPT` as an architect
recommendation, with the browser-family scope explicitly limited to actual
unpacked Chromium and with system Chrome/other browser families deferred.
Codex does not self-accept C3H.

`POST_C3H_READY: YES` for architect review. No provider outcome/replay
integration, joint offline result recovery, scheduler integration, or Stream 2
monitoring work was started.
