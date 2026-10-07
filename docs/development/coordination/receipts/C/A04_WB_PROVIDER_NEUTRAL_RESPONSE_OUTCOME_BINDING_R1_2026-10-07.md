# A04 WB provider-neutral response outcome binding R1

- Task: A04-WB-PROVIDER-NEUTRAL-RESPONSE-OUTCOME-BINDING-R1-20261007
- Role: C
- Base: fa09c0b2150e5ac97e3afda1908408e2a6a83a82
- Evidence level: SOURCE FOUNDATION ONLY
- Provider/browser/live IO: none

## Purpose

The accepted provider-neutral response policy, verifier, disposition and retention foundations are separate pure layers. This slice binds their already-produced safe outcome metadata into the existing provider-attempt state record without wiring a provider, storage sink, report formatter, delivery path or browser runtime.

The new API is `SellerAgentsProviderOutcome.attachResponseProcessing(record, disposition, retention?)`.

## State-machine boundary

The API accepts only an existing `RESPONSE_RECEIVED` provider-attempt record. It returns a new frozen record with the same state, outcome, identity, timestamps and response metadata plus one frozen `response_processing` snapshot.

It does not dispatch, retry, mark success/failure, change UNKNOWN handling or create a provider attempt. Existing `markResponseReceived`, `markKnown`, `markUnknown`, `beginPermittedRetry`, history compaction and automatic-dispatch rules are unchanged.

DISPATCH_INTENT, OUTCOME_UNKNOWN, retry-wait, completed/failed and already-bound records fail closed.

## Safe disposition snapshot

The snapshot accepts only the established provider-neutral shapes and copies an explicit allowlist:
- disposition;
- verification details: transport/http/parse/schema/semantic/source_revision/fully_verified;
- provider HTTP ok/status;
- response-processing error metadata for processing failures;
- body_omitted and chat-access block policy for processing failures.

Verification consistency is checked again at the state boundary: fully_verified must match successful schema+semantic verification, the disposition must match parse/verification state, and provider HTTP metadata must equal the already-recorded response metadata.

Unknown disposition keys are rejected. Raw body, decoded response value, arbitrary response metadata and caller-defined fields are not copied.

## Retention snapshot

Retention is optional because actual storage/quarantine IO remains a later wiring slice. When supplied it must match the disposition class.

Processing failure accepts only:
- quarantine default: stored_locally=false, raw_retention_failed=true, chat_access_blocked=true; or
- quarantine stored: stored_locally=true plus ref/sha256/byte_length and chat_access_blocked=true.

Binary response accepts only:
- one stored descriptor mirrored exactly in artifact_refs and result_policy with PREPARED_NOT_ATTACHED; or
- ARTIFACT_STORAGE_FAILED with matching provider status, automatic_retry=false, byte_length and bytes_preserved_in_result=true.

Descriptors are restricted to ref/sha256/byte_length. Binary/base64 payload, filename, mime, expires_at, provider request metadata and arbitrary descriptor fields cannot cross this boundary. Mixed binary/quarantine retention and byte-length inconsistencies fail closed.

Non-binary successful dispositions reject retention objects.

## Regression history

The first intentional red run on a correctly composed runtime failed because `attachResponseProcessing` did not exist.

A preliminary harness invocation had incorrectly supplied the repository root rather than a composed runtime and failed before assertions with missing service_worker_entry.js; this was a local invocation error, not product evidence, and is recorded in the existing ORG-007 class.

The first implementation reached the new assertions. A cross-realm deepStrictEqual test compared identical VM objects with different prototypes; the test was corrected to normalize values in the same way as the neighboring response-retention differential.

The next run exposed a real implementation defect: stored-quarantine validation passed the full quarantine object into the strict three-field descriptor validator. The implementation now constructs an explicit descriptor subset before validation, preserving the intended allowlist.

Independent review of exact candidate `3182c139bf2dca865d97e93d3265cc7599ca8ce4` returned REWORK_REQUIRED with one P1: the local descriptor helper widened the already accepted retention contract by coercing/trimming/truncating `ref` and accepting uppercase SHA-256 before lowercasing it. That candidate remains frozen as REWORK evidence. The correction now validates the descriptor with the same fail-closed constraints as provider-response-retention: `ref` must already be a non-empty trimmed string of at most 512 characters, SHA-256 must already be lowercase hexadecimal, and byte length remains a non-negative safe integer. Direct negative regressions cover non-string, padded and overlong refs plus uppercase SHA-256.

Independent re-review of exact candidate `bd63702df85c18b55d0ca25965449e78040f895c` confirmed the descriptor correction but returned REWORK_REQUIRED with one new P1: a non-failure binary disposition could still bind when `provider_http_ok=false`. The accepted retention contract only allows binary retention for a successful provider HTTP response. The correction now rejects binary dispositions unless `provider_http_ok===true`, before any retention binding; a direct HTTP 500 + binary regression proves the fail-closed boundary. The `bd63702d` review remains immutable REWORK evidence.

## Focused verification

Implementation:
- packages/bridge-core/src/execution/provider-outcome.js
- SHA256: 0dcfb5f46e2452843e1d2c939bec9659e5d541f5809a8311a16ecb1dc7ffa594

Permanent regression:
- tests/regression/extension-core/provider-outcome.mjs
- SHA256: cb3e019d415de3f5c024809ca3a4e10c4780d1374ae7358c763402fca0243d0a

Focused source + extracted package second rework result:
- /root/octoport-control/logs/C/a04-provider-neutral-response-outcome-binding-r1-20261007/FOCUSED_SOURCE_EXTRACTED_REWORK_R2_RESULT.json
- SHA256: 245efa438d7cc00bc6b137a070688147efbf2ac4ac86c1be5135b8068eaca345
- source PASS
- extracted PASS
- 33 scenarios
- Node v24.20.0
- deterministic package SHA256: dce9257e55dbef33b6c31b692c33718771fb66734916bad87646f29aaafaaee7
- provider calls 0
- browser actions 0
- credential access 0
- DB/service/live mutation 0

The existing Extension I1-C1 source/extracted gate already executes provider-outcome.mjs; no change to tooling/checks/extension_core.py is required.

## Product boundaries preserved

This slice does not perform or authorize:
- actual provider response verification invocation;
- quarantine/artifact sink IO;
- raw byte/base64 decoding or persistence;
- composition changes for the separate response-policy/verifier/disposition/retention modules;
- WB adapter or application runtime wiring;
- sanitize/report formatting;
- attachment/delivery;
- installed browser acceptance;
- provider/live acceptance.

WB provider-neutral migration therefore remains REOPENED. This SOURCE foundation must receive independent exact-candidate review and normal fresh-main task publication with five exact CI before main.
