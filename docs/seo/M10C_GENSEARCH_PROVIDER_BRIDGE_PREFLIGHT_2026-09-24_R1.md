# Octoport SEO — M10C Yandex GenSearch provider / Bridge / cost preflight — 2026-09-24 R1

Status: **PREFLIGHT PASS / INSTALLED-RUNTIME CAPABILITY PROBE REQUIRED BEFORE PAID EXECUTION**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
Preparation parent HEAD: `2bb5da9da789413c7527320f51fb1887216501fb`

## 1. Accepted upstream

M10B Main Chat acceptance:
`docs/seo/M10B_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`
blob `e35c5a8b58e3e9e34c375938a7593ffa6deb85b6`.

```text
FINAL_AI_DIAGNOSTIC_CASES = 15
MAX_SNAPSHOTS_PER_CASE = 2
M10C_PREFLIGHT_GATE = OPEN
AI_PROVIDER_CALLS_IN_M10B = 0
```

## 2. Official provider authority — fresh 2026-09-24

Official Yandex Search API authority checked:

- Generative response: `https://aistudio.yandex.ru/ru/docs/search-api/concepts/generative-response`
- REST GenSearch.Search: `https://aistudio.yandex.ru/ru/docs/search-api/api-ref/GenSearch/search`
- Operation guide: `https://aistudio.yandex.ru/ru/docs/search-api/operations/generative-search`
- Quotas/limits: `https://aistudio.yandex.ru/ru/docs/search-api/concepts/limits`
- Pricing: `https://aistudio.yandex.ru/ru/docs/search-api/pricing`

Current provider contract:
```text
ENDPOINT = POST https://searchapi.api.cloud.yandex.net/v2/gen/search
MODE = SYNCHRONOUS_ONLY
DEFAULT_GEN_REQUEST_LIMIT = 1 request/second
GEN_REQUEST_LIMIT_PER_HOUR = 1000
MAX_QUERY_CHARS = 400
MAX_QUERY_WORDS = 40
REQUIRED_ROLE = search-api.webSearch.user
API_KEY_SCOPE = yc.search-api.execute
GENSEARCH_RUB_PER_1000 = 5080
GENSEARCH_RUB_PER_REQUEST = 5.08
```

Yandex states that internal server errors and authentication errors are not billed.

## 3. M10C economics

Accepted M10B initial plan has 15 cases.

```text
INITIAL_SNAPSHOT_REQUESTS_MAX = 15
INITIAL_MAX_COST_RUB = 15 * 5.08 = 76.20

CONDITIONAL_REPEAT_REQUESTS_MAX = 15
CONDITIONAL_REPEAT_MAX_COST_RUB = 76.20

ABSOLUTE_M10B_TWO_SNAPSHOT_CEILING_REQUESTS = 30
ABSOLUTE_M10B_TWO_SNAPSHOT_CEILING_RUB = 152.40
```

Only the first snapshot set is eligible for later release. Conditional second snapshots are not pre-authorized; each depends on observed variability trigger after first-snapshot evidence is persisted/read back.

## 4. Exact Yandex Marketing Bridge authority

Repository:
`MaksimUnimax/Yandex_direct`

Production YMB version:
`0.1.9`

Production source commit:
`b218afb0187bd26af1d7ada3590b02edc2d4a2de`.

Known install ZIP SHA-256:
`de4425a47645d537ef7b69994ef2df0f66c3e9bd6741b0b47884426bdd954c4c`.

Exact production blobs verified at the commit:
```text
extension/src/manifest.json
blob dd89fb6ab3577f53b35b40f9723741e0f32e0a24

extension/src/shared/product.js
blob 58955217c47bd42aed3d7ecc44f722fac247407c

extension/src/shared/search_protocol.js
blob 49ca9a6f3a2786a3107f03d0724dfca7578cd096

extension/src/shared/policy_model.js
blob 648d9d666a81e66351f8ef154992e7812d1ff3ff

extension/src/shared/phase3_provider_runtime.js
blob 402843c5de24966e13b458b8d648067d995a72fa

extension/src/search_admission_worker_binding.js
blob b8707cfcfd3f169fe272d33aaed37d92bb958fce
```

## 5. GenSearch is already in production 0.1.9

Exact source proves:

```text
SERVICE = search
COMMAND_PREFIX = SEARCH_API_V1
RESULT_PREFIX = SEARCH_RESULT_V1
METHOD = genSearch
```

Accepted command shape:
```text
SEARCH_API_V1 {"method":"genSearch","queryText":"...","confirmBillable":true}
```

GenSearch command fields are limited to:
```text
method
queryText
confirmBillable
```

`confirmBillable` must be literal boolean true or parsing fails closed with:
`GEN_SEARCH_CONFIRM_REQUIRED`.

The Bridge builds exactly one synchronous provider request:
```json
{
  "messages": [{"content": "<queryText>", "role": "ROLE_USER"}],
  "folderId": "<configured Search folder id>",
  "fixMisspell": true,
  "getPartialResults": false
}
```

Provider endpoint:
`POST https://searchapi.api.cloud.yandex.net/v2/gen/search`.

GenSearch result preserves:
- `message.content/role`;
- `sources[].url/title/used`;
- `searchQueries[].text/reqId`;
- `fixedMisspellQuery`;
- `isAnswerRejected`;
- `isBulletAnswer`;
- `hints[]`;
- `problematicAnswer`;
- `transport.wire_format/frame_count`.

Runtime supports JSON object, JSON array and JSON Lines framing.

No automatic paid retry is implemented. Unknown network outcome is fail-closed as `REQUEST_OUTCOME_UNKNOWN_NO_RETRY`.

## 6. Provenance boundary

GenSearch is accepted as a **distinct structured AI-search evidence surface**, not consumer Alice.

Required provenance semantics:
```text
GEN_SEARCH_INPUT
GEN_SEARCH_ANSWER
GEN_SEARCH_SOURCE
GEN_SEARCH_SOURCE_USED
GEN_SEARCH_QUERY_OBSERVED
```

Forbidden equivalence claims:
```text
GEN_SEARCH_ANSWER != CONSUMER_ALICE_ANSWER
GEN_SEARCH_SOURCE != CONSUMER_ALICE_SOURCE
GEN_SEARCH_QUERY_OBSERVED != ALICE_FANOUT_OBSERVED
```

Historical bounded proxy validation in `Yandex_direct` was PASS with 5 valid observations and no material contradiction, but it explicitly forbids exact consumer-Alice equivalence.

## 7. Correction of preflight audit mistake

An intermediate Main Chat preflight initially inferred that YMB 0.1.9 lacked GenSearch because no separate production `gensearch*.js` file was present.

That inference was incorrect.

Exact source inspection at the accepted production commit proves GenSearch is implemented inside the shared Search files (`search_protocol.js`, `policy_model.js`, provider runtime and admission binding).

```text
EARLIER_FILENAME_ONLY_INFERENCE = REJECTED
EXACT_SOURCE_AUTHORITY = YMB_0.1.9_HAS_GENSEARCH
BRIDGE_PATCH_REQUIRED = false
```

## 8. Installed-runtime gate

Repository source capability does not alone prove the user's currently loaded browser instance is the exact expected runtime.

Before any billable request, execute one deliberately non-billable fail-closed capability probe using an accepted M10B query:

`ии помощник селлера`.

Probe command:
```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии помощник селлера","confirmBillable":false}
```

Expected installed-runtime result:
```text
code = GEN_SEARCH_CONFIRM_REQUIRED
request_executed = false
provider_calls = 0 / provider boundary not crossed
```

This probe validates recognition of `genSearch` and the explicit billable-confirmation guard without a paid provider call.

Unexpected outcomes:
- `UNSUPPORTED_METHOD` -> loaded Bridge is not accepted GenSearch-capable runtime; stop.
- any `request_executed=true` or provider result -> stop / safety defect.
- other local policy/runtime error -> reconcile before paid release.

## 9. Paid execution remains closed

```text
PAID_GENSEARCH = CLOSED
FIRST_PAID_CASE = CLOSED
SECOND_SNAPSHOT_REPEATS = CLOSED
M10D = BLOCKED
```

After the capability probe passes, Main Chat must persist/readback its receipt, freshly recheck tariff/contract as needed, and issue a separate release for exactly one first paid case.

No bulk run is authorized.
