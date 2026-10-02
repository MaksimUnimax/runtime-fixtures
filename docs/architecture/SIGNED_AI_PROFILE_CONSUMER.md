# Signed AI profile consumer v1

Manual controller implementation under the owner's 2026-09-28 manual-mode instruction.
Canonical schemas: `packages/contracts/src/adapter-profile.ts` and
`packages/contracts/src/signed-ai-profile.ts`.

## Scope and compatibility

This is an internal service-worker/content-script contract, not a new bootstrap
contract, signature format, remote executable patch, or release approval.
Existing adapter_profile_v1 and profile_compatibility_v1 schemas moved unchanged
from adapter-registry into contracts. The registry reexports the same schemas and
types. Existing canonical fingerprinting, size limit, rollout, and lifecycle stay
unchanged. The fingerprint covers canonical JSON of **{ content, compatibility }**,
so the relay includes both; content alone cannot reproduce that fingerprint.

Initial consumers are packaged ChatGPT and Alice web adapters with null variant.
The four v1 selector slots remain conversation, composer, send, assistantResponse.
Busy and Copy behavior stays packaged; additional selector slots require an
explicit contract change. Every primitive resolves only through packaged code.
No CSS, JavaScript, URLs, credentials, private account identifiers, conversation
text, or response text belongs in these messages.

## Ownership and trust

SellerAgentsControlClient in the extension worker remains the sole authority:
verify the existing signature, cache time, compatibility, scope, fingerprint,
and work authorization before creating an AVAILABLE response. JSON schema
validation alone does none of those things. The content script uses the extension
runtime channel; never accept a matching-looking page postMessage or external
extension message. Verify sender extension, frame, document, and supported origin
using browser-provided sender metadata, not a claimed URL in the payload.

The shared consumer schema requires each selector strategy and every primary or
fallback reference to match its slot: conversation_root/conversation-root,
composer_root/composer-root, send_control/send-control and
assistant_response/assistant-response. Each contour strategy must equal its key.
A mirrors these semantic restrictions in the browser validator. The consumer
rejects incompatible historical material as PROFILE_UNSUPPORTED; it never rewrites
signed content to make it fit. This does not tighten the historical registry v1
schema or change previously signed bytes. The old registry golden fixture uses
composer-root references in several slots, so changing that server schema would
silently invalidate previously accepted material.

## Request and response

The content script sends OZ_REQUEST_SIGNED_AI_PROFILE with protocolVersion
signed_ai_profile_consumer_v1, a fresh cryptographic UUID requestId, and its
packaged detector's AI scope. Keep at most one pending request per document.
Starting another request invalidates the older requestId. Navigation, AI scope
change, or teardown invalidates all pending responses. Do not reuse request IDs.

The worker returns OZ_SIGNED_AI_PROFILE for the exact requestId and scope:
- AVAILABLE carries authGeneration, bootstrapSnapshotSha256, and the profile's
  exact identity, content and compatibility.
- UNAVAILABLE carries only a bounded reason. It never returns previous profile
  material, tokens, an exception string, or a fallback permission to work.

Capture one verified authority snapshot, derive the response from that snapshot,
and recheck that it is still current immediately before returning it. A changed
snapshot must return AUTHORITY_CHANGED or be retried under a fresh request.
In the content script, accept a response only for its still-current pending
request and detected scope. Validate the complete strict shape and fingerprint
before use. A stale reply is ignored; it must neither apply nor clear a newer
profile. Clear the pending request after processing a response.

Use a content-initiated request instead of an unordered profile push: revision is
not a sequence number, authGeneration can remain unchanged during a profile
update, and a worker restart must not make an old counter appear fresh.
Existing authority-change notifications trigger a new request and invalidate an
outstanding one. Do not rely on a notification alone for work authorization:
the worker's current authority and exact profile fence must gate each irreversible
operation even if the notification is delayed. These lifecycle rules must be
implemented and tested by A; schema parsing does not implement them.

## Application, receipts, and rollback

At a safe boundary, atomically install the complete profile for new work.
Pin already-started work to its exact profile and existing operation fence.
Never replace resolver behavior midway through a send/delivery sequence and never
replay an irreversible action because profile application or receipt delivery
failed. A changed authorization still stops unauthorized actions immediately;
safe deferral of configuration does not defer revocation.

OZ_SIGNED_AI_PROFILE_RECEIPT echoes the request and scope:
- APPLIED identifies the actually installed authority/profile.
- DEFERRED identifies the pending candidate with WORK_IN_FLIGHT.
- CLEARED acknowledges current unavailable authority.
- REJECTED contains only a bounded rejection reason.
Receipts never echo profile content. DEFERRED is not APPLIED and a receipt is not
a server-side operator approval or proof that extension behavior works.

Before activating a deferred profile, obtain a fresh response: the saved candidate
may have been revoked while work was in flight. A newly verified assignment may
select an earlier revision for rollback. Accept that under a fresh request and
current authority; never reject rollback merely because its revision is lower.
Keep baseline acceptance, operator approval, production assignment, and browser
activation as separate recorded steps in the monitoring repair architecture.

## Required consumer acceptance

A implements and proves, for source and extracted release paths:
1. Two valid signed profiles cause a measurable intended resolver behavior change.
2. Raw selectors/code/unknown fields, bad fingerprint, unsupported scope, expired
   or revoked authority, and untrusted senders cannot activate a profile.
3. Replies arrive out of order; invalidation, same-generation profile changes,
   worker restart and document navigation cannot restore stale configuration.
4. In-flight work keeps its exact fence; deferred activation revalidates authority.
5. Verified rollback to a lower revision works; failure never resends a request
   or marketplace action. Copy versus response-level Copy behavior stays correct.
6. Installed authenticated browser checks remain separate from these source tests.

This contract candidate supplies schemas and negative contract checks only.
It does not claim browser application, live monitoring repair, store submission,
or production patch delivery.

## Candidate verification, 2026-09-28

Base: 17ad323d2251926e415653d311630739da2f333c. The extracted 195-line
profile schema block is byte-identical to that base before its new imports.
Registry schema object-identity and existing golden fingerprint checks pass.
Contracts 63, remote-config 54, adapter-registry 11, bootstrap 70, admin-ai 6:
**204 tests passed**, with the five package typechecks and changed-file lint.
Documentation check passed. Frozen offline install used cached dependencies only.
Supervised validation job 2e8ac77ce6cc4b8aa9bbcd3e6f8e8b24 exited 0, peak 865 MiB,
with descendant cleanup verified. Initial setup-path and unused test-variable
failures were corrected before this run; neither was product acceptance.
Logs: /root/octoport-control/logs/controller/manual-profile-contract-20260928/.
No browser, private login, DB migration, live deployment, or new store ZIP executed.

### A semantic review follow-up

A review b844f3cd6c554d3a9df95e6a1f7b6c841c7e9b8d identified crossed
slot/reference and contour/strategy combinations. Four new negative cases first
failed against candidate62da3d71 (63 passed / 4 failed), then passed after the
consumer-only constraints above. The unchanged registry golden fixture still passes.
Final total: contracts67 + remote-config54 + adapter-registry11 + bootstrap70 +
admin-ai6 = **208/208 tests**, all five typechecks, lint and docs PASS.
Supervised job e098f93f72184ec6b3b8c61dcb910e71 exited0, peak869 MiB,
cleanup verified. This follow-up is required together with62da3d71 before A
implements activation. Alice may return PROFILE_UNSUPPORTED until separately
accepted; ChatGPT is the first behaviorally tested consumer boundary.

## Alice behavioral acceptance follow-up — 2026-10-01

The earlier 2026-09-28 acceptance intentionally returned `PROFILE_UNSUPPORTED`
for Alice until a separate behavioral acceptance. That source/package hold is
now superseded by `A04-ALICE-SIGNED-PROFILE-CONSUMER`.

The contract and signed material remain unchanged. The extension worker now
applies the existing `signed_ai_profile_consumer_v1` boundary to both packaged
web adapters:

- `chatgpt` accepts only `https://chatgpt.com` and `https://chat.openai.com`;
- `alice` accepts only `https://alice.yandex.ru`;
- sender extension/frame/document identity remains browser-provided and
  fail-closed;
- requested AI, detected AI, tab identity, response scope and receipt scope
  must still match exactly;
- authority/profile refresh is broadcast only to the packaged ChatGPT/Alice
  web origins;
- irreversible Work Start/Resume requires the same exact applied signed-profile
  fence for both families. An unknown future family cannot silently bypass the
  fence.

The content runtime likewise applies, defers, rolls back and clears a verified
Alice profile through the same request/receipt lifecycle as ChatGPT. Signed
profiles still choose only packaged symbolic behavior; Alice DOM/composer/send/
attachment implementation remains the existing packaged Alice adapter.

This follow-up does **not** publish an Alice profile revision or assignment,
change server schemas/catalogs, or establish installed/LIVE_OWNER Alice
behavior. Source/extracted-package behavior is accepted separately from those
later gates.
