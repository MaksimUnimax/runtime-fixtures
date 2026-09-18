# Post-C3H P1-R1 provider-outcome acceptance closure

Work ID: `SA-I1-POST-C3H-P1-R1-PROVIDER-OUTCOME-ACCEPTANCE-CLOSURE-20260918-01`

Status: `P1_ACCEPTANCE_READY_WITH_BROWSER_FAMILY_DEFERRED`

## Closure basis

The original P1 candidate was not architect-accepted because it did not include
the required real unpacked Chromium proof for provider-outcome restart fencing,
and its full Extension I1 checker receipt stopped at the known APP-05 timing
race. The P1 provider-outcome architecture was retained. This R1 adds only the
bounded browser evidence and deterministic checker-harness closure.

C3H browser truth remains separate by browser family:

- Playwright Chromium 151.0.0.0 / Chromium 151.0.7922.34: real unpacked MV3
  source and extracted passes.
- System Google Chrome 147: `ENVIRONMENT_DEFERRED_GOOGLE_CHROME_MV3_REGISTRATION`.
- No Opera, Yandex, Firefox, or Safari claim is made.

The real harness is `tests/regression/extension-core/client-i1/browser_p1_provider_outcome.py`.
It loads the actual generated and ZIP-extracted extension, uses a persistent
Playwright Chromium context and actual MV3 service worker, verifies the signed
synthetic authority, and installs only a fixture provider transport. The
fixture counts transport boundary entries and stores no request or response
body.

## Real unpacked source/package matrix

Browser receipt: `/tmp/p1-r1-provider-browser-final7-1789718320225145456/summary.json`.

Both source/generated and extracted runtimes passed:

- service-worker startup and unpacked extension load;
- signed local authority reconstruction;
- control server unavailable while the local provider fixture remains usable;
- durable dispatch intent before transport;
- interruption after transport begins, worker restart, and
  `OUTCOME_UNKNOWN` persistence;
- zero additional automatic provider attempts after worker restart, page reload,
  server recovery, fresh authority, or duplicate click;
- durable known response receipt, restart, and local result recovery with one
  provider attempt;
- report START known response with one report START attempt;
- report START interruption with one initial attempt, zero additional START
  attempts, and no fabricated `reportId`.

The source and extracted runs used independent fresh browser profiles. Their
provider-attempt, restart-fencing, UNKNOWN, known-response, report, and storage
privacy results agree.

## Storage/privacy inspection

Actual `chrome.storage.local` was inspected after each major browser scenario.
The durable attempt record contained bounded technical metadata only:
logical execution identity, provider attempt identity, state, outcome metadata,
binding/store/credential revision references, timestamps, and delivery state.

The inspection found no marketplace token, Authorization header, raw request or
response body, AI conversation content, `storageState`, or private signing
material in the attempt record. The report fixture's token response was
synthetic and was not persisted as provider business data.

## 429 and report lifecycle

The real unpacked source and extracted workers both received a fixture HTTP
429 and stored `KNOWN_429` / `RETRY_WAIT_KNOWN`. Restart produced zero duplicate
transport attempts. The loaded production retry primitive created a new
`providerAttemptId`, retained the same `logicalExecutionId`, and incremented
the attempt number. No hidden automatic retry was added; Ozon's batch surface
returned `NO_QUOTA_WAIT` for an implicit resume, so the browser check did not
invent one.

The report START fixture separately proved durable intent before the report
request, known response receipt with one report START attempt, and UNKNOWN
restart fencing with no fabricated report ID. STATUS/DOWNLOAD are not folded
into START.

## Retention and tombstone safety

The provider-outcome model receipt passed in both source and extracted runtimes:
10 scenarios, all states, UNKNOWN automatic replay denied, known 429 permitted
retry identity changed. It verifies the maximum attempt history of 8 and the
one-hour UNKNOWN retention rule: stale UNKNOWN history is compacted, while
`canAutomaticallyDispatch(UNKNOWN)` remains false. Batch-context and worker
lifecycle checks cover stale requesting recovery, queue ownership, and no
automatic replay. Completed known-response restart recovery also retained one
provider attempt. No business-result archive or indefinite result retention was
introduced.

## APP-05 differential

The first final-candidate full run and both immediate focused source/extracted
runs reproduced the exact known assertion signature at
`application.mjs:193`: `1 !== 2`. An isolated untouched C3H-base run passed the
same focused APP-05 path and stopped later only at the expected external AUT-47
browser gate. The failure was therefore the pre-existing timing race signature,
not a provider-outcome assertion failure.

The deterministic harness correction awaits the already-required
`network.length === 2` condition after releasing the held request; it does not
weaken the assertion or increase a fixed timeout. The focused source and
extracted APP-05 tests then passed.

## Final full-checker receipt

Command environment used the supported Node 24 bin directory first in `PATH`
and `C3H_BROWSER_PROOF=REAL_UNPACKED_CHROMIUM_PASS`.

Receipt: `/tmp/p1-r1-final-clean-i1-node24-1789718684800145215/summary.json`

Result: `PASS`, 134 gate processes. Source and package/extracted syntax,
provider outcome, WB adapter, application, batch context, lifecycle, C3E/C3F/
C3G/C3H, D3C signed readback, and verifier gates passed. C3H AUT-01--AUT-50
passed in the accepted scopes, including AUT-47 using the real unpacked
Playwright Chromium proof.

## Package receipt

The final checker package is:

- `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`
- 1,974,754 bytes
- SHA-256 `1b101b4f3afe04d10d61640c9919882a1f7e3456fdbedaa31a42c78566a23fff`
- 39 runtime files
- repeat archive equality: true
- source/extracted byte equality: true

The dynamic browser fixture package used an ephemeral Ed25519 test key and did
not contain production secrets.

## Server and stream boundaries

`/v1/sync` was unchanged for provider-attempt state. No PostgreSQL provider
attempt/replay state, replay API, or migration was added. The server-side
`replay` symbols found by a repository scan are existing device/auth/billing
replay-window behavior, not provider replay state.

Stream-2-owned production files changed: none. Health monitoring, LLM/DOM
monitoring, Ozon/WB API watching, and monitoring schedules were not modified.

## Git and publication

The exact P1 candidate tested before the closure evidence commit was:

- HEAD `16578f9ebb9265638c1498c5479bb97322f75ef3`
- tree `0ac6bf544739b9800728b394daa3283b5884f1e6`
- parent `77c101c2dc3f9f5c7ef6124b78da52cd2c9a1572`
- C3H base `804d58b8198aa75fd8ec2830b7b37678dc8444bf`

Remote refs verified before work:

- `origin/main` = `bc718cc5c677ad0eb4598e7de3ad766473ff0847`
- `origin/integration/i1-c1-srv5-2026-09-16` = `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
- `origin/docs/roadmap-autonomy-correction-2026-09-18` = `6a48af8cd19137aaa10688c36cb064d3c4b16969`

The closure commit and remote publication receipt are recorded in the terminal
report. No force push, merge, rebase, or amend was used.

## Recommendation

`ACCEPT` for P1-R1, with system Google Chrome and other untested browser
families remaining explicitly deferred. Next step when separately authorized:
joint offline command/result completion and recovery. This task stops here.
