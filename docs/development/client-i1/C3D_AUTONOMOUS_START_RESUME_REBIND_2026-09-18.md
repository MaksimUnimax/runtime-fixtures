# C3D Autonomous Start / Resume / Store + Marketplace Rebind

Work ID: `SA-I1-C2-3-C3D-AUTONOMOUS-START-RESUME-REBIND-20260918-01`

Status: `IMPLEMENTED_CANDIDATE`

This is a candidate implementation for architectural review. It is not C3D
acceptance and does not accept C3E, C3F, C3G, or C3H.

## Baseline and scope

The branch was created from accepted local C3C commit
`5c87191fcd8dbc07ae6adf7839d92cc78e4c0736`, tree
`58ecd72b35d48b984ac560967e37bab97a2365d7`. The accepted C3B parent remains
`ed32fc19fc14ed18b7392f4a2d60c95d85e02773`, tree
`49c13d0a3de590a566dc51bc35cc215afc5fa6f0`.

The old implementation had one `saAdmitOnline` path for Start and Resume,
and that path required `acquireSignedHealthAuthority` followed by the
verified-online authority evaluator. Store and marketplace changes reached
the same online-only admission through Start. That made transport failure a
lifecycle denial and incorrectly made Health freshness a Work prerequisite.

## Canonical lifecycle flow

Start, Resume, and confirmed rebind now use one flow:

1. `ensureForIdentity` reconstructs the trusted installation-local authority
   inputs and performs the existing local cache-time/invalidation checks.
2. Local AI/page/dialogue identity, binding, selected store, credential
   revision, Work state, and race fence are read.
3. Health is attempted only as an optional online observation. A genuine
   transport-unavailable result is ignored; a verified denial, malformed
   response, signature failure, context mismatch, HTTP authorization failure,
   or programming/local-storage error remains fail-closed.
4. `SellerAgentsAutonomousWorkAuthority.evaluate` is the single lifecycle
   authority evaluator. It consumes the signed Bootstrap authority and safe
   effective time, including FRESH and valid offline grace, exact grace
   expiry denial, local invalidation, context fences, and capability
   intersection.
5. The existing local Work state machine performs the one canonical mutation.

There is no `onlineStart`/`offlineStart` or second offline authority. A
successful control-server round trip, Bootstrap refresh, Health response, or
sync ACK is not required when the local C3C authority is valid.

## Start and Resume semantics

New-dialogue Start captures the selected store immutably, creates a new local
Work generation and binding context, establishes the content baseline, and
uses the mature durable Send protocol. The pending Start is persisted before
the irreversible browser send. A proven send activates Work, a proven
pre-send failure becomes `START_FAILED`, and an uncertain outcome becomes
`START_UNKNOWN`/`outcome_unknown_no_retry`. Restart cannot create a second
prompt.

Historical Start is intentionally supported. Existing history, including
valid command blocks, report lifecycle commands, malformed command-looking
text, and user quotes, is baseline history. It is not replayed or autorun.
The new Work generation records a new baseline and only intentionally selected
commands after that baseline can enter the command path.

Resume semantics were derived from the existing donor implementation: it
requires the exact current conversation key, an existing binding, an inactive
Work session, and no active manual operation; it binds the existing context
and transitions it to visible active Work without sending a new Start prompt.
It now uses the same C3C autonomous authority as Start. It does not use a
previous online admission receipt as bearer authority.

## Store and marketplace changes

The existing popup warning and confirmation flow is preserved:

> The dialogue contains data from the previous store. The AI may mix them in
> responses. To connect the new store, start work again; a new instruction
> will be sent.

Cancel leaves the old binding untouched. Confirmation creates the rebind plan;
it does not silently rebind. For active or error Work, canonical local Finish
retires the old Work before the new target binding and Start are allowed.
The pre-token and post-Finish fences validate generation, binding revision,
store identity, marketplace, credential revision, AI/dialogue identity, and
the expected inactive source revision. Old callbacks cannot attach to the
target context.

The same model covers Ozon → Wildberries and Wildberries → Ozon. Provider
credentials remain provider-specific: Ozon seller credentials and optional
Performance credentials are not flattened into WB personal-token credentials.
Ozon Seller-only stores remain valid for Seller-supported operations; optional
Performance capability is separately validated.

## Multiple stores, dialogues, Finish, and restart

Store IDs are immutable identities; editable names do not identify a store.
Credential revisions are captured in each binding and are checked against the
selected catalog entry. Deletion and credential replacement invalidate stale
contexts. Ozon Store A, Ozon Store B, and WB Store 1 remain separate.

Conversation keys, Work generations, binding contexts, baselines, and result
delivery are dialogue-local. Provider-account quota behavior remains scoped by
provider account where the existing implementation requires it.

Finish remains local and immediate. It fences the generation, retires the
session, cancels queued local work under the accepted donor semantics, and
does not wait for a server ACK. Popup close is not Finish.

Worker restart and page reload reconstruct the signed authority without
extending grace, preserve invalidation and pending `STARTING`/
`START_UNKNOWN` truth, preserve binding/store context, and do not replay old
commands or resend a committed prompt.

## C3E/C3F/C3G boundaries

C3D adds no sync journal, request IDs, retry/backoff protocol, ACK compaction,
polling, heartbeat, WebSocket, server lease, or remote reconciliation. The
existing durable local binding/session/pending-start mutations and diagnostics
are the observation boundary C3E can consume later. No server ACK is needed
for local usability.

C3D does not implement preferred-executor reconciliation, multi-browser
ordering, conflict resolution, late ACK resolution, or convergence. C3A
provider gates remain historical bounded compatibility paths; final C3A/C3G
predispatch rewiring is explicitly deferred.

## RED batch and root causes

The accepted C3C source audit reproduced the wrong-premise dependencies before
patching: C3D-RED-01/02 new Start with FRESH or grace was blocked by mandatory
Health; RED-03 historical Start remained coupled to online admission; RED-04
Resume required the online path; RED-05/06 store and marketplace rebind used
the same dependency; RED-07 restart lacked online provenance; RED-08 Health
was treated as mandatory; RED-09/10 were the context-fence and historical
baseline risks at the lifecycle boundary. The source snapshot showed the
single `saAdmitOnline` call site and mandatory Health acquisition at the
accepted C3C base.

During implementation, the first integrated probe also exposed a duplicate
legacy capability-metadata validation (`CAPABILITY_PERMISSION_METADATA_INVALID`)
before the C3C evaluator. It was removed so the canonical evaluator owns the
intersection.

The pre-C3D full checker also exposed an environment-only pnpm launcher issue:
the `pnpm` shim selected system Node 12. Evidence was rerun with the required
Node 24.20.0 executable and pnpm 10.34.5 through Corepack.

## Test evidence

Focused C3D source/package runtime:

`/root/.nvm/versions/node/v24.20.0/bin/node tests/regression/extension-core/client-i1/client-c3d-autonomous-lifecycle.mjs <runtime>`

Result: PASS, 18/18 scenarios. The same suite passed against the composed
source runtime and ZIP-extracted runtime in `extension_i1.py`.

Full checker:

`SA_NODE_BIN=/root/.nvm/versions/node/v24.20.0/bin/node SA_PNPM_BIN=<Node-24 pnpm wrapper> python3 tooling/checks/extension_i1.py --output <fresh-temp-dir>`

Result: PASS, 126 gate processes. This includes source and package syntax,
contracts, worker/application lifecycle, races, C1 admission/rebind, C3C
authority, cached-bootstrap/offline policy, signed metadata, capability
intersection, C3A compatibility, D3C signed readback, and verifier.

Native Chromium MV3:

The harness generator `make-browser-config.mjs` generated an ephemeral
Ed25519 key in a temporary directory. Only its public trust bundle was placed
in the package; no private key was committed. The full pre-update browser
matrix passed for source and extracted runtimes. The C3D-sensitive expired
Health and transport-outage cases also passed for both runtimes after aligning
the browser expectations with the C3D policy. This is native Chromium fixture
evidence, not installed-store or live marketplace acceptance.

Provider compatibility and C3A boundary tests remained green in the full
source/package matrix. No real Ozon/Wildberries calls or owner credentials
were used.

## Documentation and package receipt

The normal documentation checker was run with Node 24. It remains blocked by
the pre-existing unrelated `repro/` batch:

- missing final newline: `repro/sa-i1-c2-3c1-r1-20260918/browser-health2/result.json`
- missing final newline: `repro/sa-i1-c2-3c1-r1-20260918/browser-verifier/result.json`
- broken links in `repro/sa-i1-c2-3c1-r2-20260918/TERMINAL-REPORT.md` to
  `stacked.bundle`, `R2-only.patch`, `final-C1.patch`, `whole-stack.patch`,
  and the local development ZIP
- missing final newline:
  `repro/sa-i1-c2-3c2-offline-continuation-authority-20260918-01/browser-c2-final/extracted/result.json`
- missing final newline:
  `repro/sa-i1-c2-3c2-offline-continuation-authority-20260918-01/browser-c2-final/source/result.json`

No new documentation error was introduced by the C3D document; `git diff
--check` passes. This preserves `PREEXISTING_DOCS_CHECK_FAILURES` rather than
claiming a whole-document PASS.

Development package receipt:

- version: `0.2.4`
- ZIP: `/tmp/sa-c3d-package-parent-Vxdjgw/package/SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`
- size: `1,922,012` bytes
- SHA-256: `c08d4fcbdc97f1aad82ea55190d9f9cc592ef3af1ed7fd49d6eaa991dca8b076`
- files: 39
- repeat build/archive: equal
- source/extracted/ZIP relevant file parity: equal for all 39 files

The package is a deterministic development artifact. ZIP parity is not
installed-browser acceptance.

## Candidate identity and deferred ledger

Candidate branch: `feature/i1-c3d-autonomous-start-resume-rebind-2026-09-18`.
Candidate tree: recorded in the terminal report after the implementation
commit. Candidate commit SHA: recorded in the terminal report after the
implementation commit.

Preserved/deferred ledger:

- `ENVIRONMENT_DEFERRED_NATIVE_CHROMIUM_FIXTURE_KEY`: closed for this run by
  the legitimate ephemeral synthetic-key generator; no secret was committed.
- `PREEXISTING_DOCS_CHECK_FAILURES`: remains open for unrelated `repro/`
  artifacts listed above.
- `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`: no remote publication was
  attempted.

No C3E synchronization journal was started. No C3F reconciliation, C3G final
predispatch rewire, or C3H acceptance was started.
