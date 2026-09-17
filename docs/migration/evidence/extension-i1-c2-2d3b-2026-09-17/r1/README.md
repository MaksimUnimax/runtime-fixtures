# C2.2-D3B bootstrap permission emission — bounded evidence

Work ID: SA-I1-C2-2-D3B-BOOTSTRAP-PERMISSION-EMISSION-20260917-01

This is an implementation receipt, not an architect acceptance record.

## Exact base and ancestry

- Repository: MaksimUnimax/runtime-fixtures
- Base branch: integration/i1-c1-srv5-2026-09-16
- Fetched remote base HEAD: 23047b3bdc22842a5b17e29e3d3f603c0ee51b16
- Fetched remote base tree: 314b3a6db2989830ef9ea7659490f4eaa7c5b39b
- Accepted D3A implementation ancestor: 4066c25595ddcc676bb87eb71b1f22956e212482
- D3A ancestry check: PASS; base is the merge of D3A as PR #23.
- Tested implementation commits: f2c332d1b8f13fde0996f47b764f99e94be028f9 and
  00f7de68260aed2ef142351eba00001e4f20af79 (the latter is the exact
  implementation/test head before this documentation-only receipt).
- Tested implementation tree: 6befa699184af679e8427725ab1a443efe6b7482.

## Bounded implementation

BootstrapService uses one pure entitlement composition path from both V1 and
V2 issuance. It copies eligible commercial entitlements into a fresh map and,
only for an existing BETA basis, validates and overlays the exact
@product/entitlements D3A vocabulary:

- source.ozon: true
- source.wildberries: true
- ai.chatgpt: true
- ai.alice: true

Validation requires an ordinary object with exactly those four own string keys,
enumerable data properties, and literal true values. Extra keys, missing keys,
false values, truthy non-booleans, aliases, accessors, arrays, and other shapes
fail closed as existing BootstrapError("UNAVAILABLE") before signing.

NONE returns a fresh empty map. COMMERCIAL-only preserves the commercial map
contents without beta overlay. BETA takes the existing S1.1 precedence and
timing path; BETA plus COMMERCIAL preserves unrelated commercial entries,
forces only the four reviewed keys to true, preserves the real commercial
subscription projection, and does not apply the commercial deadline to beta
timing. No access admission, timer, Work authority, provider dispatch, or
marketplace path changed.

The helper never mutates either input and each invocation creates independent
result state. Bootstrap V1 and V2 retain their existing envelope/schema and
signing implementations.

## Evidence

The pre-patch RED batch ran against the untouched D3A base: 15 cases, 10
behavioral failures collected before implementation. The focused post-patch
batch is 25/25 PASS. It covers D3B-01 through D3B-11, V1/V2 parity, overlap
precedence, subscription/timing separation, exact false-to-true overlay,
immutability, repeated-call freshness, policy-shape fail-closed behavior, and
real signature verification plus tamper rejection.

Affected package regression: 13 files / 224 tests PASS across entitlements,
Bootstrap, commercial/beta access, remote-config signing, and the simulated
client. Full reachable workspace unit/regression, typecheck, lint, format,
build, docs check, bridge guard, and OpenAPI check PASS. PostgreSQL is
NOT_APPLICABLE: this diff changes no database package, schema, migration, or
DB behavior. Live browser/provider acceptance is out of scope for this
non-executing permission-emission step.

This receipt does not mark C2.2-D3B accepted and does not begin signed client
read-back or executable Work authority. The next dependency is the separately
owned signed client read-back / server-policy-to-signature-to-client-verification
proof.
