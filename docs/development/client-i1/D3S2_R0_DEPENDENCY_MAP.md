# D3/S2 R0 — Dependency map

## Graph

```text
accepted C3E journal + /v1/sync + sync_entities/receipts
                    |
                    v
        accepted C3F reconciliation kernel
        (bindingRevision, Finish, markers,
         preferredExecutor, UNKNOWN, isolation)
                    |
                    +------------------------------+
                    |                              |
                    v                              v
  D3S2 store metadata/state extension       existing P1/P2/P3 path
  (same journal/repository, no secrets)      (quota, no-replay, result,
        |                                   scheduler; no reimplementation)
        v
  explicit store tombstone / credentialRevision
  / providerAccountId convergence
        |
        +----------------------------+
        |                            |
        v                            v
  transfer can bind to              export/import can start
  stable account/store/device       independently from local catalog
  metadata                         (fallback path; no relay dependency)
        |
        v
  A22/A23 ephemeral encrypted transfer
  (new contracts + metadata lifecycle,
   secret payload outside durable sync)
```

Transfer and export/import are intentionally not one implementation task.
Store metadata hardening is the earliest shared dependency, but export/import
does not have to wait for transfer and can be a separate fallback feature.

## Implementation dependencies

### Store metadata/state extension

This is an `EXTEND_CURRENT_MODEL` boundary. It should extend the existing
allowlisted `seller_agents_sync_v1` entry/state vocabulary and the existing
`sync_entities`/request-receipt repository with a clearly namespaced store
metadata representation. The local catalog remains the authority for secret
values; the server receives only safe metadata. Required fields are store ID,
account ID by authenticated scope, marketplace, display name, confirmed or
unconfirmed provider identity, credentialRevision, lifecycle/tombstone state,
and monotonic mutation/request metadata. No second journal or second
reconciliation kernel is allowed.

The extension must preserve:

- account isolation and no silent provider-account substitution;
- Ozon Seller and Performance as separate capability/credential facts under
  one store card;
- WB-specific credential requirements;
- explicit deletion/tombstone semantics without server credential storage;
- bindingRevision/Finish precedence for dialogue state;
- pending backlog compaction and independent failure outcomes.

### Transfer

Transfer requires new server contracts and likely a migration for request
metadata/status only. It does not require a new authority model. The source
and recipient can reuse:

- authenticated account/device identity from extension bearer auth;
- deviceId/installationId and session generation from C2/C3 auth state;
- account-scoped logout/revoke/reset fences;
- existing requestId/idempotency conventions as a transfer request identity;
- the current local catalog and credentialRevision/store identity;
- WebCrypto in the extension for an ephemeral recipient key pair, payload
  encryption, integrity, and recipient-bound decryption.

The existing C3E journal can carry a compact transfer-request *status* only if
the status is kept separate from ordinary binding mutations and contains no
encrypted secret payload. It must not be used as the relay queue. The safer
boundary is a dedicated transfer metadata/status contract with ephemeral
server memory for the ciphertext, explicitly excluded from DB, durable queue,
logs, tracing, crash dumps, and backups.

Required transfer rules:

1. Recipient initiates and confirms in the recipient browser; source has no
   second popup confirmation.
2. Request binds to same `accountId`, `recipientDeviceId`, `requestId`, and
   expiry. Recipient public key/ephemeral key identity is part of the request
   metadata; private key remains recipient-local and ephemeral.
3. Source must be active/reachable. Source offline is an explicit
   `SOURCE_OFFLINE`/understandable state, not a server-side secret fallback.
4. Server never decrypts or durably stores the encrypted payload.
5. ACK closes the request. Expiry, logout, revoke, account substitution,
   malformed recipient binding, or packet replay fails closed.
6. A repeated transfer request must be idempotent for metadata but must not
   replay an already ACKed/consumed secret packet.
7. No permanent global channel, Work heartbeat, or provider replay path is
   introduced.

### Export/import

Export/import can be implemented independently as a local catalog feature. It
does not depend on transfer, C3E, server availability, or a second browser.
It does depend on the local catalog's account boundary, credential
normalization, credentialRevision calculation, and existing store/binding
conflict rules. The export envelope needs an explicit version, bounded size
and complexity, password-based KDF parameters, nonce, authenticated
integrity/tag, and a strict allowlist of store/credential fields. Sessions,
technical result buffers, server tokens, and Work state are excluded.

Import must authenticate/decrypt and validate before writing, reject unknown
executable-semantics fields, accept old formats only through named adapters,
surface store-ID/provider-account conflicts explicitly, preserve account
isolation, and never call Start/Resume/queue/provider/scheduler as a side
effect.

## Acceptance dependencies

| Feature | Must be accepted before implementation is useful | Can be accepted independently |
|---|---|---|
| Store metadata/state | Existing C3E/C3F tests remain green; local catalog invariants | Live provider identity evidence is separate |
| Transfer | Store/account/device identity rules; auth/revoke/reset contract; ephemeral relay privacy tests | Full export/import; P1/P2/P3 provider outcome path |
| Export/import | Local catalog and credential normalization | Transfer, server sync, live provider access |
| Provider quota coordination | P1 no-replay and P3 re-gating | Store transfer/export |
| Product diagnostics | Safe allowlist and privacy tests | Stream 2 monitoring agents |

## Owner/live/environment dependencies

- A02 needs owner-authenticated Ozon Seller/Performance and provider identity,
  rights, and expiry evidence. Code can define fail-closed semantics with
  synthetic values, but it cannot manufacture live provider proof.
- A10/A13/A25 require owner/live AI or account evidence as listed in the
  acceptance receipt.
- A26 needs real browser/OS installations; Chromium does not imply Firefox,
  Safari, Opera, or Yandex.
- Remote publication remains environment-deferred. It is not a product
  dependency and must not be “fixed” by changing the local candidate.

## Stream 2 boundaries

Stream 2 owns health/DOM/API monitoring and schedules. No D3/S2 task may add
monitoring agents, health polling, API watchers, or their scheduler under:

- `apps/health-runner/**`
- `packages/server/health/**`
- `tooling/api-watch/**`

The accepted C3H/P3 code only consumes signed Health/freshness interfaces and
does not depend on a periodic monitoring call for authority. If a future
store/transfer contract must be shared with Stream 2, classify it as
`PARALLEL_STREAM_DEPENDENCY`, publish one reviewed contract, and do not create
a parallel implementation. No such shared-contract change is needed to begin
the recommended store metadata extension.

## Transfer replay versus P1 no-replay

Transfer request idempotency is control-plane protocol idempotency, not
provider business replay. A duplicate request may return the same safe request
status. It may not cause a second source encryption/send after consumption, a
second recipient import after ACK, or a second provider command. P1's
`OUTCOME_UNKNOWN` rule remains untouched and applies only to marketplace
outcomes. P2's known-result recovery and P3 wake processing remain local and
must not be used to schedule transfer payload replay.

## Earliest safe recommendation

Proposed ID: `D3S2-EXT-C3E-C3F-STORE-METADATA-STATE-2026-09-18`.

Scope for the next architect-issued implementation task:

- extend the existing C3E/C3F contract and repository, not create a second
  sync journal or authority;
- add allowlisted account-scoped store metadata/state and an explicit deletion
  tombstone/equivalent state;
- propagate display name, marketplace, providerAccountId status (confirmed or
  explicitly unconfirmed), credentialRevision, and lifecycle revision safely;
- preserve local secret ownership, Ozon Seller/Performance separation, WB
  rules, bindingRevision/Finish ordering, late ACK and out-of-order ACK safety,
  bounded backlog isolation, and disconnected UNKNOWN semantics;
- define synthetic-only RED tests and scoped contract/migration checks;
- do not implement transfer, export/import, monitoring agents, live provider
  actions, or publication in the same task.

This boundary is high-value because both transfer and future multi-install
store UX need one stable metadata identity, while it is directly testable from
the accepted local code and does not require owner external action to begin.
Architect acceptance is required before implementation starts.
