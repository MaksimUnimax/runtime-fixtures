# C3G corrected provider predispatch

Work ID: `SA-I1-C2-3-C3G-REWIRE-COMMAND-PREDISPATCH-CORRECTED-AUTONOMY-20260918-01`

Status: `IMPLEMENTED_CANDIDATE_WITH_ENVIRONMENT_GAP`

Base: C3F `9724a9b8089a933148a27e7cb01f0b33b7e9e142`, tree
`c17672b9db2e2342731df3647bff89370010b61b`. The final candidate SHA/tree is
recorded in the terminal report and in the follow-up documentation closure
commit.

## Architecture

The historical C3A provider dependency on the old active-session-only
`saAssertWorkAuthority` path is removed from provider guard construction. The
remaining local lifecycle admission check is named
`saAssertLocalAuthorityAdmission`; it protects Start/Resume/message admission
and is not the provider predispatch authority.

There is one provider decision: `saEvaluateDispatchAuthority(owner)`. Ozon and
Wildberries provider runtimes already expose the mature final `guardedFetch`
boundary; every actual provider request invokes the same decision immediately
before `fetch`. The decision performs a local read, C3C autonomous-authority
evaluation, C3F reconciliation check, a second local read, and a final fence
comparison:

```text
current local signed authority
  + current dialogue/Work context
  + current binding/store/credential context
  + local invalidation
  + durable C3F reconciliation state
  -> one local predispatch decision
  -> provider request only if the complete fence still matches
```

The guard construction performs only a non-authorizing local control-client
checkpoint so local expiry/invalidation cleanup remains durable. Its boolean is
ignored. It does not contact the control server and cannot authorize a provider
request; `saEvaluateDispatchAuthority` is the sole provider decision.

The trusted fence includes account, device/session and generation, signed
authority identity and freshness, AI/profile identity, origin and conversation,
Work generation/session, binding identity/revision, marketplace, store,
credential revision and presence, local invalidation, and the current signed
permission/capability intersection. Pinned command hash/request ID and the
current operation context are compared against the live record. Popup changes
cannot retarget a pinned command.

Authority states are exact: `FRESH` and
`STALE_BUT_OFFLINE_GRACE_ELIGIBLE` are eligible when the rest of the fence
passes; `CACHE_EXPIRED` denies. Equality at `offlineGraceUntil` denies. Grace
is never extended, and Health TTL is not used as authority TTL.

## C3F reconciliation

`SellerAgentsSyncJournal.assertCurrentActionAllowed` is consumed at the
last-mile gate. A known newer explicit binding revision, known Finish, local
binding/store/marketplace mismatch, or durable explicit conflict requiring
rebind resolution denies the affected dialogue before a provider request.
Explicit conflict classifications are fail-closed locally.

Same-binding convergence remains eligible. Unknown remote state, disconnected
installations, stale sync, and server unavailability remain unknown and do not
deny a valid local Work. `preferredExecutor` is not a lease, permission, or
mutex: another installation may be preferred while this valid local Work still
executes. Delivery markers are not authority and do not replay work.

The reconciliation check is dialogue-scoped. An affected conflict produces
zero provider calls while unrelated dialogues remain executable.

## Re-gating and no replay

Each explicit command gets a fresh current read and provider predispatch gate.
Multi-command processing does not carry an initial allow to the next command;
Finish, logout/reset/revoke, store deletion, credential replacement, binding
revision, conflict, or grace expiry fences the next request.

Report lifecycle operations use the same rule for START, STATUS, and DOWNLOAD;
an earlier report ID or ownership record is not sufficient authority for a later
request. Existing Ozon report provenance and cross-store/binding protections
remain in place.

After a provider 429 wait, the next attempt re-runs the complete local gate.
No Seller Agents control request is made to re-authorize the retry, and the
provider-specific Retry-After/quota state remains provider-scoped.

An unknown provider outcome is durable `UNKNOWN` and is never automatically
resent after restart, reload, sync ACK, reconciliation convergence, preferred
executor change, or server recovery. C3G adds no replay path.

## Provider boundaries

Ozon Seller and Ozon Performance credential distinctions are unchanged:
Seller operations do not require Performance credentials, while Performance
operations use the current Performance credential revision. Wildberries keeps
its token rules, domains, safety classification, quota behavior, and provider
errors; no Ozon credential assumption crosses the marketplace boundary.

## RED batch

The complete requested RED inventory was audited before the patch. The
reachable production failures were:

- `C3G-RED-10`: known newer explicit binding revision was not consumed at the
  provider boundary;
- `C3G-RED-11`: known explicit binding conflict was not consumed at the
  provider boundary.

The other requested RED classes were not reachable as failures on the accepted
C3C–C3F line: autonomous Start/Resume/rebind, valid grace, exact expiry,
multi-command fencing, report/provider mature gates, 429 handling, preferred
executor independence, credential fencing, and UNKNOWN no-replay already had
bounded local coverage. C3G preserves those tests and adds the C3G source and
package boundary suite.

## Evidence

Focused C3G command, source/package parity, C3C, C3D, C3E, C3F, application,
WB, and cache-time suites passed. The focused C3G suite covers fresh Ozon,
offline-grace Ozon, fresh WB, exact grace boundary, stale binding revision,
explicit conflict, credential revision, Finish between commands, preferred
executor independence, two valid commands, same-binding convergence, and
known Finish. Its provider call count is zero for denials and one/two only for
the intended allowed cases; no live marketplace call is made.

The full Extension I1 checker passed both source and extracted runtimes:

```text
PATH=/root/.nvm/versions/node/v24.20.0/bin:$PATH \
SA_NODE_BIN=/root/.nvm/versions/node/v24.20.0/bin/node \
SA_PNPM_BIN=/root/.nvm/versions/node/v24.20.0/bin/pnpm \
python3 tooling/checks/extension_i1.py --output <fresh-output>
```

It completed 130 gates with status `PASS`. The deterministic package was
`SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`, 1,954,743 bytes,
SHA-256
`0f6b1a469c7df2dd9442e765bb0c766e238c0738f850f6e9ae8f8219115eb14c`,
39 files, repeat archive equality, and source/extracted byte parity.

The Ozon report file lifecycle fixture passed. The WB adapter suite passed
17 cases, including credential isolation, 429, unknown outcome, report file,
and no-replay behavior. The historical Ozon runtime predispatch fixture was
also run; its single `RUNTIME-00` order assertion remains a pre-existing
historical fixture failure. The historical full-worker fixture requires its
older popup sender setup and remains outside the generated I1 package gate.

## Browser, package, and server scope

Generated and extracted package runtime acceptance passed. Native MV3 smoke is
not called PASS: `ENVIRONMENT_DEFERRED_NATIVE_MV3_REGISTRATION` remains the
accepted pre-initialization shared registration/service-worker defect from
C3E/C3F. No production sleep or bypass was added.

No server, database, health-runner, API-watcher, scheduler, or monitoring
files were changed. No server suite was rerun because no server interface was
modified. Stream 2-owned production files changed: `NONE`.

Diagnostics retain only technical reason codes and allowlisted identifiers.
Credentials, tokens, reports, private messages, storageState, signing keys,
and raw session material are not emitted in evidence.

Remote publication remains deferred unless existing legitimate credentials are
available; no force push, reset, rebase, merge, or amend is permitted.
