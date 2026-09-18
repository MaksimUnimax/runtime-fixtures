# S2-L2 Standard dedicated Health session capability

Work ID: `S2_L2_STANDARD_DEDICATED_HEALTH_SESSION_CAPABILITY_2026-09-18_R3`

Verdict: `STANDARD_DEDICATED_HEALTH_SESSION_CAPABILITY_NONLIVE_CANDIDATE`

This document records only the non-live R3 capability. It does not claim live
ChatGPT acceptance, authentication validity, Work support, Alice, P8.5, or full
S2-L2 acceptance.

## Authority and reviewed lineage

| Item | Value |
| --- | --- |
| Repository | `MaksimUnimax/runtime-fixtures` |
| Worktree | `/root/runtime-fixtures-s2r3` |
| Branch | `feature/stream2-health-l2-standard-session-2026-09-18` |
| Accepted R2 parent/base | `0b2dc92df4f8221ed03915fc9b63c3c17b4be197` |
| Accepted R2 tree | `8d6da963bb4e2ee1afab2fd50546d8662d2fe140` |
| Current integration authority re-verified before finalization | `23047b3bdc22842a5b17e29e3d3f603c0ee51b16` |
| Historical Health head reviewed | `d4bae8752c304cd49ef5c0f4ef2b5d44281d0f95` |

The complete post-B6 B7A lineage was read at the initial provisioning commit
`592b51da31ab5ecfd0e4d4b3e981897849731614` and corrected R1 commit
`d4bae8752c304cd49ef5c0f4ef2b5d44281d0f95`, including the B7A document,
dedicated-session implementation/tests, browser driver, root API, and the
dedicated-session E2E path.

The initial design accepted a public structural binding carrying a raw
`storageStatePath`, and an optional third `ChromeBrowserDriver` constructor
argument. The strict loader was therefore optional: a fabricated binding could
reach `browser.newContext({ storageState: ... })`. R1 corrected this with a
type-only opaque registry, module-private `WeakMap` provenance, a private
resolver, and a separate private driver binding map. Those security properties
were retained without bringing the historical Work API into R3.

## Standard-only boundary

The loader accepts only version `1` with the exact target key
`chatgpt_standard_health` and the exact target field `storageStatePath`.
Unknown fields and `chatgpt_work_health` configuration fail closed. A runtime
request for the Work target is rejected as `TARGET_NOT_CONFIGURED` before a
driver is constructed or a browser context can be created.

The public API is:

```ts
loadDedicatedHealthSessionRegistry(configFilePath)
createDedicatedHealthChromeBrowserDriver(
  targets,
  opaqueRegistry,
  "chatgpt_standard_health",
  launchTimeoutMs?,
)
```

The normal constructor remains `new ChromeBrowserDriver(targets,
launchTimeoutMs?)`; extra JavaScript arguments confer no authority. No public
binding object, storage-state path, Work start URL, constructible registry, or
raw resolver is exported. The loader validates an absolute regular non-symlink
owner-readable state file, bounded size, and POSIX owner-only permissions, but
never parses or serializes the state contents.

The dedicated factory alone attaches the validated path to a private driver
`WeakMap`. Launch still uses `chromium.launch()` and a fresh
`browser.newContext({ acceptDownloads: false, storageState })`. Persistent
contexts, profile directories, context reuse, authentication writeback,
`storageState({ path })`, login automation, CAPTCHA bypass, and provider calls
are absent. Closing a driver removes its private state-path capability.

## RED evidence

Before production implementation, the focused R3 red probes were run against
the exact accepted R2 parent. All 8 required probes failed as expected because
R2 had no dedicated loader/factory exports (`expected undefined to be type of
'function'`); no browser was launched and no state file was consumed. The
required cases were forged registry, extra constructor argument, symlink,
relative path, unsafe permissions, unknown fields, Work request, and result /
evidence serialization.

The historical R1 review also recorded the two direct rejected-design RED
proofs: a forged factory binding and a third constructor argument each caused
the synthetic dedicated cookie to reach the loopback request on the initial
candidate. Those bypasses are not possible through the R3 public surface.

## GREEN evidence

| Check | Result |
| --- | --- |
| Dedicated session unit tests | 11 passed, 0 failed |
| Full Health runner unit suite | 115 passed, 0 failed, 9 files |
| Dedicated synthetic Chromium loopback | 3 passed, 0 failed |
| H2 Chromium security matrix | 13 passed, 0 failed |
| Standard H3 Chromium regression | 37 passed, 0 failed |
| Combined isolated Health Chromium matrix | 53 passed, 0 failed |
| Health runner typecheck | PASS |
| Monorepo typecheck | PASS |
| Lint and bridge guard | PASS |
| Format and focused format check | PASS |
| Health runner build | PASS |

The synthetic Chromium checks prove dedicated cookie visibility only through
the trusted loader/factory, separate fresh runs, default-driver cookie
isolation, bounded cleanup, no state writeback, sanitized navigation results,
the top-level navigation firewall, and Work fail-closed behavior. Evidence
sanitization rejects unapproved raw fields and the serialized result/evidence
surfaces contain neither the state path nor synthetic cookie content.

The existing H3 action, engine, contract, Standard profile, and persistence
unit coverage remained green. No selector, prompt, command, copy,
conversation, completion, or persistence contract was changed.

## Privacy and security audit

Only temporary synthetic state was created during tests. It used a loopback
fixture and synthetic cookie material; no real credentials, owner/customer
cookies, provider domains, or reusable repository auth fixture were used.
The loader does not read state contents. The state path is held only in the
private provenance map and is not enumerable or serializable. Results and
sanitized evidence contain only bounded Health-owned fields.

The final source audit classified `storageState` as the single intended
dedicated `newContext` input; `userDataDir` and `launchPersistentContext` have
no matches; auth writeback has no call site; `WeakMap` occurs only in the two
private provenance maps; raw binding exports have no matches; and raw paths,
cookies, tokens, passwords, secrets, and authorization material are absent
from production result/evidence fields. Synthetic test sentinels are confined
to temporary tests.

There were zero live ChatGPT, provider, marketplace, customer-session, login,
CAPTCHA, checkpoint, anti-bot, geoblock, or security-bypass calls.

## Work exclusion and remaining boundary

No Work dedicated config field, Work route, Work session registry entry, Work
factory binding, or Work executable target was added. Existing generic H3 Work
vocabulary is unchanged; this R3 cannot provision or launch a Work dedicated
session. Work support requires a deliberate later slice after accepted Work
execution authority is present on the current Stream-2 line.

No Stream 1 path, product auth/bootstrap/session behavior, product Work
runtime, Start/Resume/rebind, I1/C2 authority, migration, DB production
change, or shared product contract was modified.

## Publication and deferred ledger

The branch is local and was not merged, force-pushed, or cherry-picked. No
publication retry was made. Git publication remains
`ENVIRONMENT_DEFERRED`; credentials and remote publication are outside this
bounded implementation run.

The future owner-deferred item remains `S2-L2-CHATGPT-STANDARD-LIVE-001`.
It was not run or resolved here.

## Bounded next slice

After exact-head review/acceptance and owner-controlled live authorization, the
next bounded S2-L2 slice is `S2-L2-CHATGPT-STANDARD-LIVE-001`. It must remain a
separate live validation task; this document establishes only the
non-live Standard dedicated-session capability candidate.
