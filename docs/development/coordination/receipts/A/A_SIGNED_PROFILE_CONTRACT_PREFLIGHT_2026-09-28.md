# A — signed profile consumer contract preflight — 2026-09-28

Status: **DRAFT CONTRACT COMPATIBLE / TWO STRICTNESS GAPS FOUND / NO SHARED FILE EDIT BY A**

Controller notice:
`CONTROLLER-SIGNED-PROFILE-CONTRACT-20260928-0545`.

Controller worktree:
`/root/octoport-control/worktrees/controller/manual-profile-contract-20260928`.

Observed draft base:
`17ad323d2251926e415653d311630739da2f333c`.

A did not edit any controller-reserved shared path.

## What already aligns

The draft canonical schemas match the browser-side profile vocabulary already enforced
inside `packages/control-client/src/client.js`:

- schema version `adapter_profile_v1`;
- compatibility version `profile_compatibility_v1`;
- contract versions v1/v2;
- browser-family and version constraints;
- strategy vocabulary;
- symbolic selector references only;
- no arbitrary CSS selector, URL or JavaScript field;
- exact profile fingerprint over `{content, compatibility}`.

The control client already stores the full verified signed profile material in the
current authority and validates its content SHA before work is allowed.

The existing public browser API is sufficient for delivery without a new server call:
- `SellerAgentsControlClient.getAuthority()` returns a clone of the current authority;
- `generation()` supplies the auth generation;
- application runtime already computes the bootstrap snapshot SHA from the verified
  envelope.

Therefore the future consumer does not need a new profile endpoint, signing service,
remote-code channel or DB change.

## Strictness gaps to fix before canonical commit

The draft currently constrains a selector plan's `strategy`, but it does not constrain
the symbolic reference carried by its primary/fallback primitives to that slot.

For example, the draft schema accepts this semantically wrong combination:

- selector slot: `send`;
- strategy: `send_control`;
- primary reference: `copy-control`.

Likewise a composer plan can reference `busy-control` and remain schema-valid.

The canonical contract should fail closed by binding each selector slot/strategy to the
corresponding packaged symbolic reference:

- conversation / `conversation_root` -> `conversation-root`;
- composer / `composer_root` -> `composer-root`;
- send / `send_control` -> `send-control`;
- assistantResponse / `assistant_response` -> `assistant-response`.

That restriction should apply to both primary and fallback primitives. Accessibility
role primitives may still carry their allowed role, but their symbolic reference should
remain the same slot reference.

A second cross-field gap exists in contours. The draft accepts a contour such as:

- key: `send_control`;
- strategy: `assistant_response`.

The canonical strict schema should bind contour key to its same-named canonical strategy:
`page_identity`, `conversation_root`, `composer_root`, `send_control`,
`busy_state`, `assistant_response`, `copy_control`.

The current server registry schema and browser validator inherited this permissiveness.
All observed project fixtures use the intended matching pairs, so tightening these
cross-field relations matches existing intended material rather than introducing a new
selector language.

If the shared schema is intentionally left permissive, A would have to duplicate these
semantic rejects in the browser consumer. A recommends putting the rule in the canonical
schema and mirroring it in the browser-safe validator so producer and consumer fail the
same malformed profile.

## Minimal A consumer implementation after exact contract handoff

A can consume the contract without redesigning Work.

### Worker side

Use `apps/extension/src/application/runtime.js`.

Handle `OZ_REQUEST_SIGNED_AI_PROFILE` and the receipt message in `saHandleMessage`
outside popup-only guards.

Request handling must:
- trust `sender.tab`, not a caller-supplied tab/conversation identity;
- require current verified work authority;
- compare requested AI family/surface/variant to the trusted tab identity and signed
  bootstrap scope;
- obtain full material only from `SellerAgentsControlClient.getAuthority()`;
- derive `authGeneration` from `generation()`;
- derive `bootstrapSnapshotSha256` from the already verified envelope;
- return only the contract's profile material and authority fingerprint;
- make no provider request and no new server request.

The first implementation should close the ChatGPT/web/null path required by S1.
Alice can return `PROFILE_UNSUPPORTED` until its profile consumer has separate
behavioral acceptance.

Receipt handling should compare its authority/profile identity with the current verified
authority before recording an APPLIED result. A rollback to a lower revision remains
valid when the current signed authority explicitly points to that lower revision; revision
numbers are identities, not a monotonic client delivery sequence.

### Content side

Do not edit the frozen imported donor directly. Existing Octoport content-script product
changes are composed through `apps/extension/application-patches.json`; the new consumer
should follow that same path.

Keep applied profile state ephemeral in the content runtime. Do not persist remote
selector material as the existing manual Send/Copy/Microphone profiles and do not reuse
those manual profiles as the remote-profile channel.

Resolve only symbolic packaged references through existing packaged behavior:
- composer root from the current AI adapter's `composerContext()`;
- send control through the packaged composer/send classifier;
- assistant response through the packaged adapter's assistant-message functions;
- busy state through the packaged adapter's generation state;
- copy contour through the already packaged owned-code-block/copy logic;
- conversation/page roots through packaged, bounded DOM anchors.

No remote CSS, XPath, arbitrary attribute expression or executable JavaScript is added.

## Work and authority race handling

Existing Work admission already fingerprints:
- profileKey;
- revision;
- scopeVariant;
- contentSha256;
- auth generation;
- bootstrap snapshot SHA.

Existing `SellerAgentsControlClient.onAuthorityChanged()` already enters
`saInvalidateAuthority()`, cancels admissions/pending starts and finishes active Work.
No second Work authority model is required.

The draft response is still an authority snapshot, so applying it must be bounded:

- never hot-switch a profile while `saContentContext.work_active`, Work-start watch,
  active delivery/manual composer wait or active auto watch is in flight;
- return the contract's `DEFERRED / WORK_IN_FLIGHT` receipt instead;
- reacquire the current profile during normal content state sync/route changes and again
  before the next irreversible Work-start composer/send boundary;
- clear the ephemeral applied profile on an UNAVAILABLE response;
- accept an APPLIED receipt in the worker only when its authority/profile fingerprint is
  still current.

This closes the response→apply race without adding a new remote service. Active Work is
already terminated on authority change; an idle stale profile cannot be used for the next
Work start because the consumer refreshes before that boundary.

## Existing refresh points

The current content runtime already has suitable lifecycle points:
- initial content startup;
- `syncAllState()`;
- conversation route change;
- Work runtime renew/start;
- immediately before `OZ_WORK_SEND_INITIAL_PROMPT`.

The consumer can refresh at those bounded points rather than introduce a new high-rate
poller.

## Acceptance after the shared contract is committed

A should then add a focused source + extracted-package behavioral regression proving:

1. valid signed profile A selects packaged behavior A;
2. valid signed profile B changes one intended packaged DOM behavior;
3. malformed slot/reference and contour/strategy combinations fail closed;
4. arbitrary CSS/JS/URL material is rejected;
5. active Work returns DEFERRED and continues on the old profile;
6. after Finish, the current signed profile is applied;
7. authority generation/snapshot/profile drift prevents stale application;
8. rollback to a currently signed earlier revision works;
9. authority loss clears the applied profile;
10. current no-profile behavior remains the packaged baseline.

Only after those tests pass should A claim SOURCE/PACKAGE profile consumption. Installed
and live monitoring/repair acceptance remain separate.

No product code was changed during this preflight.
