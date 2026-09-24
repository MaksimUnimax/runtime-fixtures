# Octoport SEO — M10C progress

Date: 2026-09-24
Status: **CASE01–CASE05 TERMINAL CLOSED / CASE06 SNAPSHOT02 RELEASED**
Branch: `seo/wordstat-batch-01-2026-09-16`

## Accepted chain

```text
M0..M9 = ACCEPTED
M10A = ACCEPTED / FROZEN SEARCH-ONLY BASELINE
M10B = ACCEPTED / 15 FINAL AI DIAGNOSTIC CASES
M10C = CURRENT
M10D = BLOCKED
M11+ = BLOCKED
```

## Provider / Bridge authority

```text
PROVIDER = Yandex Search API GenSearch
ENDPOINT = POST /v2/gen/search
MODE = synchronous only
CURRENT_RUB_PER_REQUEST = 5.08
DEFAULT_RATE_LIMIT = 1 generative request/second

BRIDGE = Yandex Marketing Bridge 0.1.9
SOURCE_REPO = MaksimUnimax/Yandex_direct
SOURCE_COMMIT = b218afb0187bd26af1d7ada3590b02edc2d4a2de
BRIDGE_PATCH_REQUIRED = false
```

Preflight:
`docs/seo/M10C_GENSEARCH_PROVIDER_BRIDGE_PREFLIGHT_2026-09-24_R1.md`
blob `337f984e3da0218ed8fae0e745bf6802aba1a3bc`.

Capability probe release:
`docs/seo/M10C_GENSEARCH_CAPABILITY_PROBE_RELEASE_2026-09-24_R1.md`
blob `bc6910c0230ea251bef1345ef28b37bbb5ccda99`.

## Current authorized action

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии помощник селлера","confirmBillable":false}
```

Expected local fail-closed result:
```text
GEN_SEARCH_CONFIRM_REQUIRED
request_executed = false
provider boundary not crossed
```

## Cost state

```text
INITIAL_CASES = 15
INITIAL_MAX_COST_RUB = 76.20
CONDITIONAL_REPEATS_MAX = 15
ABSOLUTE_TWO_SNAPSHOT_CEILING_RUB = 152.40
```

Capability probe receipt:
`docs/seo/M10C_GENSEARCH_CAPABILITY_PROBE_RECEIPT_2026-09-24_R1.md`
blob `31fa4dced95ddc3d505c908d68142e7a92f3d1b1`.

Case01 paid release:
`docs/seo/M10C_GENSEARCH_CASE01_PAID_RELEASE_2026-09-24_R1.md`
blob `eb3541b0d61d854ba5519274cb496aae68ce0561`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"ии помощник селлера","confirmBillable":true}`

Exactly one paid provider request is authorized. Next case and second snapshot remain closed.

Case01 snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE01_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `43f02c8a9604df35fe2c31fe799fa35d8d84d914`.

Case01 snapshot-1 assessment:
`docs/seo/M10C_CASE01_SNAPSHOT01_RECEIPT_2026-09-24_R1.md`
blob `9b79c9989453be15f5f544916330751b06401baf`.

Conditional snapshot-2 release:
`docs/seo/M10C_CASE01_SNAPSHOT02_RELEASE_2026-09-24_R1.md`
blob `47608031b91bfe87b9cd070c35b011afff8744b2`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"ии помощник селлера","confirmBillable":true}`

This is the second and final authorized snapshot for Case01. Third snapshot and next case remain closed.

Case01 terminal closure:
`docs/seo/M10C_CASE01_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `607062e3913d8683942af82ceccbd77413fa2a27`.

```text
CASE01_SNAPSHOTS = 2/2
CASE01_TERMINAL_EVIDENCE_STATE = STABLE_MIXED_CAPABILITY_FRAMING
CASE01_ESTIMATED_PROVIDER_COST_RUB = 10.16
CASE01_THIRD_SNAPSHOT = FORBIDDEN
```

Case02 snapshot-1 release:
`docs/seo/M10C_CASE02_SNAPSHOT01_RELEASE_2026-09-24_R1.md`
blob `1caa33f32766420a2ff612c02f1fe620ed2e6fac`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"подключить ии к маркетплейсу","confirmBillable":true}`

Exactly one Case02 provider request is authorized. Case02 snapshot-2 and Case03 remain closed.

Case02 terminal closure:
`docs/seo/M10C_CASE02_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `2b505708271f31cedc7591a829a1f85c812585a9`.

```text
CASE02_SNAPSHOTS = 1/2_ALLOWED
CASE02_TERMINAL_EVIDENCE_STATE = COHERENT_CONNECTOR_MCP_FRAMING
CASE02_ESTIMATED_PROVIDER_COST_RUB = 5.08
CASE02_SNAPSHOT02 = CLOSED
```

Case03 snapshot-1 release:
`docs/seo/M10C_CASE03_SNAPSHOT01_RELEASE_2026-09-24_R1.md`
blob `296bc2420e7b9a508c82fe05aa5edfad432fb61f`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"ии агент для озон","confirmBillable":true}`

Exactly one Case03 provider request is authorized. Case03 snapshot-2 and Case04 remain closed.

Case03 terminal closure:
`docs/seo/M10C_CASE03_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `34fbfeda446ed1ac1d7c108443f0b973f23ee8c5`.

```text
CASE03_SNAPSHOTS = 1/2_ALLOWED
CASE03_TERMINAL_EVIDENCE_STATE = COHERENT_AUTONOMOUS_WRITE_FRAMING
CASE03_ESTIMATED_PROVIDER_COST_RUB = 5.08
CASE03_SNAPSHOT02 = CLOSED
```

Case04 snapshot-1 release:
`docs/seo/M10C_CASE04_SNAPSHOT01_RELEASE_2026-09-24_R1.md`
blob `7e69fb0842733530e22693355699703791b3b8be`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"chatgpt для ozon","confirmBillable":true}`

Exactly one Case04 provider request is authorized. Case04 snapshot-2 and Case05 remain closed.

Case04 snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE04_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `57df01f760eaebe7ef02c4a8c5374c4bffcc51a9`.

Case04 snapshot-1 assessment:
`docs/seo/M10C_CASE04_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `37f4bada33ae9a159a5ceb1556788070f6443e63`.

Case04 conditional snapshot-2 release:
`docs/seo/M10C_CASE04_SNAPSHOT02_RELEASE_2026-09-24_R1.md`
blob `b94177eab4334fb230f7fe87502ed1f57befae87`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"chatgpt для ozon","confirmBillable":true}`

This is the second and final authorized snapshot for Case04. Third snapshot and Case05 remain closed.

Owner quality-priority directive:
`docs/seo/M10C_OWNER_QUALITY_PRIORITY_DIRECTIVE_2026-09-24_R1.md`
blob `6dbde17502348053b00a4bddbac00542bf96a78a`.

Case04 terminal closure:
`docs/seo/M10C_CASE04_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `68ea695d36045406023b5300453c14f9a89ad18a`.

```text
CASE04_SNAPSHOTS = 2
CASE04_TERMINAL_EVIDENCE_STATE = STABLE_MIXED_CONNECTOR_CONTENT_ANALYTICS_FRAMING
CASE04_ESTIMATED_PROVIDER_COST_RUB = 10.16
```

Case05 snapshot-1 release:
`docs/seo/M10C_CASE05_SNAPSHOT01_RELEASE_2026-09-24_R1.md`
blob `5bbfb5628efdf9c5c010253682b30504710b827b`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"chatgpt для wildberries","confirmBillable":true}`

Exactly one Case05 provider request is authorized. Snapshot-2 is favored when any decision-relevant doubt remains; Case06 remains closed.

Case05 snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE05_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `84d4651a5f19133490c0b4bffee1a2d19fcd47bc`.

Case05 snapshot-1 assessment:
`docs/seo/M10C_CASE05_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `a3306ec80359ebeb5a4637fa9b1092a794ee88ac`.

Case05 snapshot-2 release:
`docs/seo/M10C_CASE05_SNAPSHOT02_RELEASE_2026-09-24_R1.md`
blob `0876d402d961dbecd2d6d954868e22b3c45c5ac9`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"chatgpt для wildberries","confirmBillable":true}`

One second Case05 snapshot is authorized under the owner quality-priority rule. If material doubt remains after it, Main Chat must amend the case before any third request. Case06 remains closed.

Case05 terminal closure:
`docs/seo/M10C_CASE05_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `299d03c54f92971ad68ea290c60f14345a2f6fef`.

```text
CASE05_SNAPSHOTS = 2
CASE05_TERMINAL_EVIDENCE_STATE = STABLE_MIXED_LIVE_CONNECTOR_AND_FILE_REPORT_ANALYTICS
CASE05_ESTIMATED_PROVIDER_COST_RUB = 10.16
```

Case06 snapshot-1 release:
`docs/seo/M10C_CASE06_SNAPSHOT01_RELEASE_2026-09-24_R1.md`
blob `cd7ea08565b0deb8dbfe62e0f93321ccf36a3d5a`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"подключить chatgpt к маркетплейсу","confirmBillable":true}`

Exactly one Case06 provider request is authorized. Quality-priority rule remains active; Case07 remains closed.

Case06 snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE06_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `1bcbd9b49744ea6b5b43f678989f0ec5f25c58c2`.

Case06 snapshot-1 assessment:
`docs/seo/M10C_CASE06_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `edcdf2a1bdfc693eec00c1afe18a1f77587d5b36`.

Case06 snapshot-2 release:
`docs/seo/M10C_CASE06_SNAPSHOT02_RELEASE_2026-09-24_R1.md`
blob `0b4d5b6159d1ae4234de18ac59465c0afce97b70`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"подключить chatgpt к маркетплейсу","confirmBillable":true}`

One second Case06 snapshot is authorized. If material doubt remains after it, Main Chat must amend the case before any third request. Case07 remains closed.
