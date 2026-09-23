# S2-L3 Alice dedicated authenticated Health session capability

`WORK_ID`: `S2_L3_ALICE_DEDICATED_HEALTH_SESSION_CAPABILITY_2026-09-18_R2`

Bounded verdict: `ALICE_DEDICATED_HEALTH_SESSION_CAPABILITY_NONLIVE_CANDIDATE`.
This is not architect acceptance, `LIVE_ALICE_PASS`, provider-blocker
completion, full S2-L3 acceptance, S2-L2 live pass, or P8.5.

## Lineage and scope

| Item | Value |
| --- | --- |
| Repository | `MaksimUnimax/runtime-fixtures` |
| Worktree | `/root/worktrees/stream2-health-l3-alice-nonlive-2026-09-18` |
| Branch | `feature/stream2-health-l3-alice-session-2026-09-18` |
| Exact parent | `564aa2b598154acdbd7ed40cdf1e45631fd92f25` |
| Parent tree | `c0005b59bcd9674876b2b7b9e5be31e5afdb9d98` |
| Parent of Alice R1 | `d107287e7a9cf82290a5a6afad89e67c10e00494` |
| Integration re-verified before editing | `23047b3bdc22842a5b17e29e3d3f603c0ee51b16` |
| Historical Health reference | `d4bae8752c304cd49ef5c0f4ef2b5d44281d0f95` |
| Current `origin/main` after final fetch | `bc718cc5c677ad0eb4598e7de3ad766473ff0847` |

The primary checkout contained unrelated dirty Stream-1 material. Work was
isolated in the clean exact-parent worktree above; no unrelated checkout
changes were touched.

## Accepted Alice R1 authority and C11 provenance

Alice DOM/send/code authority remains the accepted imported/reference adapter
material from R1. Alice conversation identity is specifically sourced from
the WB reference delivery-capability/conversation-identity line:

- origin: `https://alice.yandex.ru`;
- conversation path segment: `chat`;
- canonical conversation support: `false`;
- active conversation evidence: required.

R2 therefore validates a private controlled route only as
`EXPECTED_CONTROLLED_CONVERSATION_ROUTE`. The existing Alice H3 runtime still
requires active-history corroboration and still fails closed for missing or
mismatched history. The route alone is not C11 identity proof.

## Red-first results

The exact R1 parent was inspected before implementation and the following
bounded red conditions were real:

| Probe | Parent result |
| --- | --- |
| AD-RED-01 | `alice_health` was rejected by the dedicated config schema. |
| AD-RED-02 | No dedicated Alice factory was exported or implemented. |
| AD-RED-03 | No private Alice fixed-route capability binding existed. |
| AD-RED-04 | No Alice binding union member existed; a structurally matching plain object could not produce Alice authority. |
| AD-RED-05 | Dedicated Standard/Work factories had no Alice target or Alice capability path. |
| AD-RED-06 | No dedicated Alice cross-surface isolation path existed. |
| AD-RED-07 | Duplicate-state checking covered only the then-configurable Standard/Work set. |
| AD-RED-08 | No Alice URL/UUID returned-driver reflection proof existed. |

## Implementation contract

Version 1 now accepts any non-empty explicit subset of:

```json
{
  "version": 1,
  "targets": {
    "chatgpt_standard_health": { "storageStatePath": "/absolute/state.json" },
    "chatgpt_work_health": {
      "storageStatePath": "/absolute/work.json",
      "startUrl": "https://chatgpt.com/g/g-private/c/UUID"
    },
    "alice_health": {
      "storageStatePath": "/absolute/alice.json",
      "startUrl": "https://alice.yandex.ru/chat/UUID"
    }
  }
}
```

Unknown target keys and fields remain rejected. Alice `startUrl` is bounded,
HTTPS-only, exact-origin, credential/query/fragment-free, and must match the
accepted `/chat/<UUID>` route syntax. Root, fresh `/chat/`, malformed UUID,
other-origin, and normal Yandex URLs are rejected with bounded error codes;
paths, UUIDs, and state material are not included in errors/results/evidence.

The loader retains the accepted secure file protocol: absolute paths,
regular-file and symlink checks, bounded size, owner-only POSIX permissions,
`O_NOFOLLOW` where available, descriptor/path device+inode identity, secure
read-through-open, post-read identity checks, and deeply frozen in-memory
state. All configured target pairs are compared by device/inode, including
Standard↔Work, Standard↔Alice, and Work↔Alice; hardlinks and same-path aliases
fail as `DUPLICATE_STORAGE_STATE` without comparing auth contents.

The private registry is still a frozen empty public object backed by a
module-private `WeakMap`. Its deliberately extended binding union contains
only the target-specific frozen storage snapshot and, for Work/Alice, the
validated private route. No package-root resolver or internal module is
exported through `package.json`.

`createDedicatedAliceHealthChromeBrowserDriver` requires the exact trusted
`alice_health` binding, creates a fresh filtered target registry, copies only
the validated caller timeout policy, uses the trusted private Alice URL as
the actual start URL, and permits only the exact Alice origin in controlled
Chromium. The driver stores the capability behind module-private state and
ECMAScript `#targets`; it has no public `targets` property. Standard and Work
factories remain target-specific and cannot consume Alice authority.

## GREEN mapping

The dedicated-session suite passed `55/55` tests. The requested matrix maps as
follows:

| IDs | Result |
| --- | --- |
| AD01–AD04 | Alice-only, existing Standard-only, existing Work-only, and distinct three-target configs pass. |
| AD05–AD15 | Missing/extra fields, Standard `startUrl`, scheme/origin/credential/query/fragment/route/UUID negatives pass. |
| AD16–AD18 | Alice symlink, unsafe POSIX permissions, and replacement-during-read negatives pass. |
| AD19–AD21 | Standard↔Alice and Work↔Alice same-path and hardlink identity negatives pass. |
| AD22–AD25 | Registry JSON, spread, own keys, and descriptors reveal no authority. |
| AD26–AD28 | Forged plain, frozen, and Proxy registries fail closed. |
| AD29–AD33 | Returned-driver serialization/reflection, public `targets`, root exports, and package export boundary remain clean. |
| AD34–AD38 | Caller route/origin/registry mutation and alternate URL attempts cannot replace the trusted private route; cross-surface factory use fails closed. |
| AD39–AD44 | Synthetic state loads into two fresh Chromium contexts, source deletion does not affect the loaded snapshot, source is not written back, replacement cannot alter the snapshot, and paths do not escape. |

The Alice H3 deterministic matrix remains unchanged and passed with the
complete Health-runner unit suite. Active-history identity remains required;
missing/mismatched history still fails closed; blocked `oknyx` is not clicked;
Stop/listening never sends; send count, completion, code ownership, Copy, and
delivery composer ownership remain R1 behavior. No provider call was made.

Standard, Work, and dedicated ChatGPT security contracts were rerun through
the shared Health-runner suite; the new Alice target is not consumable by
their factories, and the existing opaque capability/reflection/writeback
boundaries remain green. H2 tests remain green. No P6 execution was needed in
this bounded change.

## Validation

- Dedicated session: PASS, `55/55`.
- Full Health-runner unit suite: PASS, `170/170` from `apps/health-runner`.
- Health-runner typecheck: PASS under Node 24.
- Dedicated Alice controlled Chromium boundary: PASS through synthetic
  `start()`/fresh-context/no-writeback/source-deletion checks; no Alice route
  was opened.
- Provider/live Alice calls: `0`.
- Root typecheck: PASS under Node 24 with pnpm `10.34.5`.
- Root build: PASS.
- Lint and bridge guard: PASS.
- Format check: PASS.
- Documentation check: PASS.
- `git diff --check`: PASS.
- P6: not run; no legitimate need arose in this bounded capability slice.

## Security/privacy audit

Reviewed production matches for `storageState`, `storageStatePath`, `startUrl`,
conversation identity, route keys, persistent profiles, cookies, auth/token/
password/secret, `WeakMap`, serialization, logging, and errors. The only
Alice private route/state references are in the validated loader, the
module-private binding map, the private driver capability map, and the driver
launch/open handoff. There is no `launchPersistentContext`, auth writeback,
context reuse, raw session resolver, raw state/path/result/evidence export, or
provider-specific Alice login/CAPTCHA/checkpoint selector invention.

No files under `apps/extension/**`, `packages/ai-adapters/**`,
`packages/bridge-core/**`, `packages/control-client/**`,
`packages/marketplaces/**`, product auth/bootstrap/session, product Work
runtime, I1/C2 authority, DB, migrations, or server product behavior were
modified.

## Deferred ledger and publication

`OWNER_DEFERRED_TEST S2-L3-ALICE-LIVE-001`: requires a dedicated authenticated
Alice Health account/session, fixed controlled Alice conversation, sanctioned
runner session material, and live C01–C13 verification, especially C08
completion, C11 active-history identity, C12 delivery target, and provider
blocker behavior. It was not run and no owner procedure is supplied.

`S2-L2-CHATGPT-STANDARD-LIVE-001` and
`S2-L2-CHATGPT-WORK-LIVE-001` remain deferred. Publication was not attempted
in this bounded run; if credentials remain unavailable, publication is
`ENVIRONMENT_DEFERRED`. No merge, force push, scheduler, P8.5, product
adapter patch, login automation, CAPTCHA bypass, or live provider call was
performed.

## Next autonomous Stream-2 step

After architect review, continue to the next independent non-live
Stream-2 monitoring/health/change-detection roadmap slice. Alice live
verification remains owner-deferred and is not an autowork continuation.
