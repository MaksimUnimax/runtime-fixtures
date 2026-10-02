# Existing installed-client release preflight — 2026-10-01

Status: SOURCE change only; not installed, deployed, or live release acceptance.
Base: deb7294b4248af7c8176426899923914bce970af.
Scope: CONTROLLER-EXISTING-CLIENT-PREFLIGHT, PLAN C06.

## Confirmed problem and limits

The prepared C 0.2.11 issuer stores only an access bearer and explicitly records
refreshCredentialPersisted:false. It is a one-shot probe, not reusable release
authentication. That issuer was denied before execution; this design limitation
does not establish the reason for the platform denial. The ordinary extension
client already persists and rotates its credentials. Its auth ownership, rotation,
idempotency, storage and generation fences must be reused rather than cloned.

## Change

The privileged control client exposes acquireBootstrapPreflight for an exact
v2 request with no AI context. It requires existing credentials, refuses pending
activation before restore, binds packaged version/browser/device/account/origin,
uses the existing authenticatedRequest and validates the signed response.
It returns only the signed envelope and bound context, without credentials or
Work authority. It does not create a device, copy a profile, or initiate login.

createStore1InstalledClientTransport composes that operation with the existing
planStore1ActivationWithVerifiedPreflight transport. The caller supplies a handle
to an already authorized, identified installed worker and the independently
authorized admin config reader. Signature verification, current-config checks,
candidate acceptance, backups and bounded publication remain mandatory.
No profile discovery, token-file fallback, direct HTTP fallback or live operation
was added. The live C release caller has not been switched to this transport.

## Verification

12 Node synthetic client tests cover expiry, persisted rotation, reply loss,
storage failure, restart, concurrency, revocation, wrong context, logout races,
invalid proof and mutation of caller input.
75 Vitest tests pass: installed transport 12, activation 34, signed preflight 14,
CLI 15. ESLint, Prettier, JS syntax, Python syntax and diff checks pass.
The client regression is connected to the existing extension I1 CI SOURCE stage.
Local logs: /root/octoport-control/logs/controller/existing-client-preflight-20261001/.
These tests do not establish installed or live readiness.

## Remaining delivery boundary

The immutable 0.2.11 ZIP does not contain this new API and remains unchanged.
A new accepted package and matching release pins are required before using it.
The live platform denial remains unresolved and must not be bypassed; this source
change is not clearance to repeat denied issuance or credential inventory.
The existing client must already have a permitted valid connection; missing or
revoked authorization is reported, not silently replaced.
