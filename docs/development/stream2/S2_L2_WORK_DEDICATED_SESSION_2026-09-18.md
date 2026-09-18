# S2-L2 Work dedicated Health session capability — 2026-09-18

`WORK_ID`: `S2_L2_CHATGPT_WORK_DEDICATED_HEALTH_SESSION_CAPABILITY_2026-09-18_R6`

Bounded result: `WORK_DEDICATED_HEALTH_SESSION_CAPABILITY_NONLIVE_CANDIDATE`.
This record does not claim architect acceptance, a live ChatGPT pass, Standard
live validation, full S2-L2 acceptance, Alice, P8.5, or a product-runtime
change.

## Lineage and reviewed authority

| Item | Value |
| --- | --- |
| Repository | `MaksimUnimax/runtime-fixtures` |
| Worktree | `/root/runtime-fixtures-r6` |
| Branch | `feature/stream2-health-l2-work-session-2026-09-18` |
| Exact parent | `71f3ec2ec49fa9a5331239e0af24377e6e536120` |
| Parent tree | `e8aec244be4db8b19872a0fca8d316af443ef49d` |
| Parent of R5 | `fdf8e7049a764fb188fc72d6e63e5ececefcaba4` |
| Current integration re-verified | `23047b3bdc22842a5b17e29e3d3f603c0ee51b16` |
| Historical Health/B7A input reviewed | `d4bae8752c304cd49ef5c0f4ef2b5d44281d0f95` |

The current R5 Work implementation and current R4 Standard dedicated-session
implementation were read before editing. The historical B7A dedicated-session
loader, browser driver, tests, and Work profile were reviewed as design input.
Its path-binding design was not reused: R6 retains the R4 in-memory,
deep-frozen storage snapshot and module-private `WeakMap` provenance model.

## RED before implementation

The exact R5 parent established these bounded RED results:

| Probe | Exact parent result |
| --- | --- |
| WD-RED-01 | Work config rejected as `CONFIG_SCHEMA_INVALID`; loader was Standard-only. |
| WD-RED-02 | No `createDedicatedWorkHealthChromeBrowserDriver` existed. |
| WD-RED-03 | No Work capability could be acquired; forged/unknown registry authority failed closed. |
| WD-RED-04 | Standard factory had no Work URL handoff; a Work request was `TARGET_NOT_CONFIGURED`. |
| WD-RED-05 | Same Standard/Work state identity protection was not implemented because Work config was not accepted. |
| WD-RED-06 | Hardlink duplicate-state protection was not implemented for the same reason. |
| WD-RED-07 | No dedicated Work driver existed. |
| WD-RED-08 | Existing Standard-only boundary was already negative: opening Work on the Standard driver failed before navigation. |

## Implementation contract

Version 1 accepts `targets` containing Standard only, Work only, or both, with
at least one target. Standard has exactly `storageStatePath`. Work has exactly
`storageStatePath` and `startUrl`. Paths must be absolute. Config and state
files are bounded, regular, non-symlink, owner-only on POSIX, descriptor
identity checked, read through the open descriptor, and checked again after the
read. Parsed state is deeply frozen in memory; no later path reopen is used.

The Work URL is accepted only when it is HTTPS, has the exact
`https://chatgpt.com` origin, has no credentials/query/fragment, and parses
with the accepted Work project/conversation route parser. The
`projectRouteKey` and `conversationId` remain private capability data. The
route is supporting authority only; the existing positive `Работа` marker
remains the Work strategy proof. No model authority or picker interaction was
added.

When both targets are configured, validated `(device, inode)` identities are
compared. Same path and hardlink-to-the-same-inode state fail with the bounded
`DUPLICATE_STORAGE_STATE` code without comparing secrets or putting paths in
errors.

The public registry is a frozen empty object. Its binding map is module-private
and keyed by a `WeakMap`. Standard and Work bindings contain only a deeply
frozen state snapshot, with Work additionally containing the validated private
start URL. The root package exports no raw resolver or binding object.

`createDedicatedHealthChromeBrowserDriver` resolves Standard only and filters
its target registry to Standard. `createDedicatedWorkHealthChromeBrowserDriver`
resolves Work only, filters to Work, and internally replaces only the target's
start URL with the trusted private Work URL. Caller-controlled route data cannot
replace it. Both factories use the normal `ChromeBrowserDriver` without adding
authority to its constructor. Launch remains a fresh ephemeral
`chromium.launch()` plus `browser.newContext({ storageState })`; there is no
persistent profile, writeback, cookie injection, or cross-run context reuse.

## GREEN evidence

The focused unit suite covers WD-01 through WD-27. The deterministic Work
controlled-Chromium boundary starts two fresh dedicated Work drivers without
opening the provider route; the private URL selection is proved at the internal
capability boundary and actual provider navigation remains deferred. Existing
Standard dedicated Chromium proves the shared authenticated-context handoff,
no writeback, and navigation firewall. Generic Work behavior remains covered
by the accepted 42-scenario fixture.

| IDs | Evidence |
| --- | --- |
| WD-01–03 | Work-only, Standard-only, and distinct two-target config loads. |
| WD-04–13 | Missing/extra fields, invalid origins/schemes/credentials/query/fragment, route shape, UUID, and unknown-field negatives. |
| WD-14–18 | Symlink, permissions, replacement-during-read, same-path, and hardlink identity negatives. |
| WD-19–23 | Serialization/spread/reflection privacy and forged/plain/frozen/proxy registry rejection. |
| WD-24–27 | Target-presence isolation, powerless constructor arguments, and root API resolver privacy. |
| WD-C01–C03 | Work factory fresh controlled contexts and unchanged synthetic state; no provider navigation. |
| WD-C04 | Private validated Work URL overrides caller route data at the dedicated factory boundary. |
| WD-C05 | Existing controlled navigation firewall remains active; dedicated Standard redirect test passes, and Work uses the same driver firewall. |
| WD-C06–C07 | Dedicated Work cannot resolve Standard; dedicated Standard cannot resolve Work. |
| WD-C08 | Registry, navigation result, and sanitized evidence contain no path, cookie, URL, project key, conversation UUID, or storage state. |

Executed validation counts: dedicated-session unit/Work-focused and complete
Health-runner unit suite `142 passed`; dedicated Standard/Work controlled
Chromium `4 passed`; dedicated Work boundary `1 passed`; generic Work
Chromium `42 passed`; Standard Chromium `37 passed`; H2 Chromium `13 passed`.
Health-runner typecheck, root typecheck, root build, lint, bridge guard,
format check, documentation check, and `git diff --check` all passed.
There were zero provider or live ChatGPT calls.

## Non-interference and live boundary

Generic Work H3 remains credential-free and non-live. Standard dedicated
authority remains Standard-only. No Stream 1 path, product Work runtime,
auth/bootstrap/session path, Start/Resume/rebind, I1/C2 authority, server
product, database, migration, or persistence schema was changed.

`OWNER_DEFERRED_TEST S2-L2-CHATGPT-STANDARD-LIVE-001` remains deferred. R6
adds `OWNER_DEFERRED_TEST S2-L2-CHATGPT-WORK-LIVE-001`, requiring a dedicated
authenticated Health Work account/session and fixed approved controlled Work
conversation. It must validate the actual marker, route, composer, send,
response, completion, command, and delivery behavior. Neither live test was
run; current proof is deterministic and non-live only. No owner procedure is
delivered during autowork.

Publication was not attempted in this bounded run; if credentials remain
unavailable the publication state is `ENVIRONMENT_DEFERRED`. The next
autonomous Stream-2 recommendation after architect review is an independent
non-live monitoring/health/change-detection slice, not either deferred live
test and not Alice or P8.5.
