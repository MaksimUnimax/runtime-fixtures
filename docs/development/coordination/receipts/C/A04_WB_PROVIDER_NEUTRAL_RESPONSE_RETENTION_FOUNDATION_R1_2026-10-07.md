# A04 WB provider-neutral response-retention foundation R1

- Task: A04-WB-PROVIDER-NEUTRAL-RESPONSE-RETENTION-FOUNDATION-R1-20261007
- Role: C
- Base / fresh origin main at source boundary: aa39f3974db34c2bad32fdcade26a1a83301a9dc
- Evidence level: SOURCE FOUNDATION ONLY
- Receipt created: 2026-10-07T11:56:40.624425+00:00

## Exact scope

This slice introduces only a pure provider-neutral post-sink/outcome policy plus its behavioral differential and permanent source gate:

1. packages/bridge-core/src/execution/provider-response-retention.js
2. tests/regression/extension-core/provider-response-retention.mjs
3. tooling/checks/extension_core.py
4. this receipt

It does not perform artifact/quarantine IO, decode or retain raw bytes, write files, call a provider/browser/credential/DB/service/live queue, format reports, deliver artifacts, or wire apps/extension/composition.json or packages/marketplaces/wildberries/src/adapter.js.

## Accepted dependency contract

The retention layer requires SellerAgentsProviderResponseDisposition to exist with its accepted success/processingFailure API.

It fail-closes on the accepted disposition shape:
- processing failures require accepted verification details, provider HTTP metadata, response_processing error metadata, body_omitted=true and chat_access_blocked=true;
- binary success requires provider_http_ok=true, parse=binary and the accepted relation between fully_verified and disposition:
  - fully_verified=false -> BINARY_BYTES_CAPTURED;
  - fully_verified=true -> VERIFIED_PROVIDER_SCHEMA_AND_SEMANTICS.

This prevents widening the provider contract with fabricated partial disposition objects and preserves valid fully-verified binary responses.

## Independent review correction history

The first frozen candidate `10459402cfe602b4cbf0a02ec9543c8feaf6fa46` received independent Luna review verdict `REWORK_REQUIRED` with P0=0, P1=1, P2=0.

The proven P1 was descriptor over-retention: the common `descriptor()` validator returned `{{...value}}`, so unexpected caller fields such as `content_base64` could cross into `artifact_refs` and `result_policy.artifact`.

The successor correction removes descriptor spreading and returns only the provider-neutral allowlist:
- `ref`
- `sha256`
- `byte_length`

The behavioral differential now normalizes mature donor descriptors to the same neutral subset and includes explicit anti-leak vectors proving raw/base64/provider-filename fields do not cross the common retention boundary.

The old candidate/review remain immutable REWORK history and are not reused as PASS evidence.

A second frozen successor, d41160ffe75cc8d2af0d2e10900d37b88e44df9b, was independently reviewed as REWORK_REQUIRED with P0=0, P1=1, P2=0.

The second proven P1 was an accepted-verifier consistency gap: a fabricated binary disposition could set fully_verified=true and parse=binary without carrying schema=pass and semantic=pass. The accepted response verifier never produces that combination.

The next successor therefore requires schema and semantic string fields and enforces:

fully_verified == (schema == pass && semantic == pass)

before accepting either BINARY_BYTES_CAPTURED or VERIFIED_PROVIDER_SCHEMA_AND_SEMANTICS. The differential includes explicit inconsistent-shape rejection vectors in both directions.

The d411 candidate/review also remain immutable REWORK history and are not reused as PASS evidence.

A third frozen successor, 4ebc52fda68b8d2b5eac0832c09e9353cffcf7ec, was independently reviewed as REWORK_REQUIRED with P0=0, P1=0, P2=1.

The proven P2 was byte-length consistency: binaryStored accepted a stored artifact descriptor byte_length that differed from the caller-owned payload byte length, allowing artifact_refs and result_policy to describe the same successful artifact with conflicting sizes.

The next successor therefore rejects stored descriptor/payload length mismatch with the existing PROVIDER_RESPONSE_BYTE_LENGTH_INVALID code and adds a direct mismatch regression. No new error code, storage behavior, provider IO or delivery policy is introduced.

The 4ebc candidate/review remain immutable REWORK history and are not reused as PASS evidence.

Exact 4ebc review evidence:
- path: /root/octoport-control/logs/C/A04-WB-RETENTION-R1-4EBC-REVIEW-20261007-result.md
- SHA256: 43cb7c1cf59f242ba4b979d845d24578fecc18f459529150ffe732d3b8fb166f
- verdict: REWORK_REQUIRED; P0=0, P1=0, P2=1.

Exact d411 review evidence:
- path: /root/octoport-control/logs/C/A04-WB-RETENTION-R1-D411-REVIEW-20261007-result.md
- SHA256: a6c0033ccb32919c98dd0d49ea6391da871c9e21269cf3d3f3fd5d10a08d9b73
- verdict: REWORK_REQUIRED; P0=0, P1=1, P2=0.

Current uncommitted successor correction evidence is bound by the rev371 organization gate below. It is not treated as independently accepted until a new frozen successor receives a fresh review.

## Mature WB donor semantics preserved

Donor: migration/reference/wildberries-v0.3.0/runtime/shared/wb_provider.js
- donor SHA256: ef2c1522cd7b29e88b8e739a6db1c1c7340dbeed8d1cb38c9f567587e6ef2f39

Pure retained outcomes:
- quarantine absent or sink-failed -> stored_locally=false, raw_retention_failed=true, chat_access_blocked=true;
- quarantine success -> stored_locally=true with validated ref/sha256/byte_length and chat_access_blocked=true;
- binary storage success -> artifact_refs plus artifact/byte_length/delivery_status=PREPARED_NOT_ATTACHED;
- binary storage failure -> ARTIFACT_STORAGE_FAILED with provider_http_status, provider_ok=true, automatic_retry=false, byte_length and bytes_preserved_in_result=true.

The raw bytes/base64 are deliberately not copied into this common policy. They remain caller-owned/out of scope.

Descriptor and byte-length values are validated fail-closed. Provider-specific filename prefixes, operation names, mime-extension mapping and the sink calls themselves remain outside this common layer.

## Exact source evidence

- provider-response-retention.js SHA256: 62d744e0ab662831f16e3b1117146afabf8c384b5a01a3280502bb31fd2b3623
- provider-response-retention.mjs SHA256: 1ce19772572a8d71ce16c1aeb315d755f10b24033b02eba6b3c1ab13a1ec0b3e
- tooling/checks/extension_core.py SHA256: b718c4277946e272fe45545d89b6ea28f637a2e2b8b01c0941e0920ab9855dab
- accepted provider-response-disposition.js SHA256: cf6669a4de63a8cac97a597ee61a16184e2c3817961ecdc6eb06d64e02b71db8

Focused corrected differential:
- path: /root/octoport-control/logs/C/a04-provider-neutral-response-retention-foundation-r1-20261007/FOCUSED_DIFFERENTIAL_P2_FIX.log
- SHA256: 0b7c5e02be3a77ef243441842244260aee81696d6af5496caff55a02450bd407
- PASS: 32 assertions
- external provider calls: 0
- browser actions: 0
- credential access: 0
- DB/service mutation: 0
- live queue mutation: 0
- actual storage IO: 0
- packaged runtime widened: false

Neighbor foundation readback:
- path: /root/octoport-control/logs/C/a04-provider-neutral-response-retention-foundation-r1-20261007/FOCUSED_NEIGHBORS_P2_FIX.log
- SHA256: 75c101fb6cf7229cdfcf6e9d1459bed088fb44f74fb8a1de88149a2e820d737c
- policy 33 PASS; verifier 31 PASS; disposition 14 PASS; retention 32 PASS.

Organization gate before receipt/freeze:
- comparison: /root/octoport-control/logs/C/a04-provider-neutral-response-retention-foundation-r1-20261007/org-audit/comparison-before-p2-correction-rev371.json
- SHA256: 5febb4f60ee14268c6103f9da1a221b8434eed4a1cfa0da434546a105a2c3fe7
- report: /root/octoport-control/logs/C/a04-provider-neutral-response-retention-foundation-r1-20261007/org-audit/report-result-before-p2-correction-rev371.json
- SHA256: 26a49a665f877686f3afc09fabba78b8c07b3f2e71b63a25ff8a2387e5124003
- registry revision: 371
- all 39 organization IDs covered; review-clock issues empty.

## Mandatory heavy gate is still pending

The full permanent extension-core source/extracted gate is NOT claimed PASS yet.

Previous normal admission:
- evidence: /root/octoport-control/logs/C/a04-provider-neutral-response-retention-foundation-r1-20261007/DISK_HEAVY_D411_BEGIN.json
- SHA256: e31a90e8d3da2d9d3860ebf9c8b14a54e495b23a0cebbcdfa5ed24ed05c3198d
- status: DISK_LIFECYCLE_BLOCKED due normal disk-capacity admission, not a source/test failure (latest recorded available=14354 MiB; required=14573 MiB; shortfall=219 MiB).

Current resource snapshot:
- latest normal heavy admission evidence is the blocked d411 admission above;
- the read-only d411 review child allocation has since been CLOSED and cleaned;
- a fresh 768 MiB heavy admission is intentionally deferred until the corrected successor is frozen and independently reviewed PASS.

The same failed heavy estimate is not reduced to bypass admission. Full extension-core heavy PASS on the frozen exact candidate remains mandatory before task-publication registration/CI/main.

## Product/currentity boundaries preserved

- WB INSTALLED remains FAIL / blocked.
- Provider-neutral WB migration remains REOPENED / completeness not proven.
- Historical R1-R8 source/evidence slices remain CLOSED as prior slice work; this foundation does not reopen or rerun them.
- Installed/provider certification is not inferred from those historical slices.
- Actual artifact/quarantine IO, response-policy wiring, composition/runtime integration, contract sanitize/report formatting, delivery and installed/provider acceptance are future separate slices.

## Negative authority

No provider call, browser action, credential access, DB/service mutation, live queue mutation, actual storage IO, composition widening, WB adapter wiring, quota/cache/LKG/planner/admission/entitlement/business-date migration, sanitize/report formatting, or delivery integration was performed by this foundation.

This receipt does not authorize publication by itself. Publication remains blocked until exact candidate independent review PASS and full extension-core heavy PASS.
