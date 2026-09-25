# Octoport SEO — M10C progress

Date: 2026-09-24
Status: **CASE01–CASE13 TERMINAL CLOSED / CASE14 SNAPSHOT01 RELEASED**
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

Case06 terminal closure:
`docs/seo/M10C_CASE06_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `39954bd37a11917af9b0f8dbc47e12bc2f4edb2e`.

```text
CASE06_SNAPSHOTS = 2
CASE06_TERMINAL_EVIDENCE_STATE = STABLE_CONNECTOR_REPORT_MIX_WITH_PERSISTENT_SCOPE_CONTAMINATION
CASE06_ESTIMATED_PROVIDER_COST_RUB = 10.16
```

Cumulative paid GenSearch through Case06:
```text
PAID_REQUESTS = 10
ESTIMATED_COST_RUB = 50.80
```

Case07 snapshot-1 release:
`docs/seo/M10C_CASE07_SNAPSHOT01_RELEASE_2026-09-24_R1.md`
blob `6e111de5cb8ba0076075ae94f9882f305ce7e1e5`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"ии агенты для маркетплейсов","confirmBillable":true}`

Exactly one Case07 provider request is authorized. Quality-priority rule remains active; Case08 remains closed.

Case07 terminal closure:
`docs/seo/M10C_CASE07_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `e6de4bf06b0745a253edafd3acbf18294211d00f`.

```text
CASE07_SNAPSHOTS = 1/2_ALLOWED
CASE07_TERMINAL_EVIDENCE_STATE = COHERENT_AUTONOMOUS_MARKETPLACE_AGENT_FRAMING
CASE07_ESTIMATED_PROVIDER_COST_RUB = 5.08
```

Cumulative paid GenSearch through Case07:
```text
PAID_REQUESTS = 11
ESTIMATED_COST_RUB = 55.88
```

Case08 snapshot-1 release:
`docs/seo/M10C_CASE08_SNAPSHOT01_RELEASE_2026-09-24_R1.md`
blob `91c1fa7e72e6faed44186bb2a2c94f4972896da6`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"сервис аналитики маркетплейсов","confirmBillable":true}`

Exactly one Case08 provider request is authorized. Quality-priority rule remains active; Case09 remains closed.

Case08 snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE08_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `57cb5ac41bf5955edb9bc176faa52c5c02b3aa11`.

Case08 snapshot-1 assessment:
`docs/seo/M10C_CASE08_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `9b4852a26d5c6bd90688c99413fad4327e231cae`.

Case08 snapshot-2 release:
`docs/seo/M10C_CASE08_SNAPSHOT02_RELEASE_2026-09-24_R1.md`
blob `0259251f28934a38db1e3f454618ab71857826f1`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"сервис аналитики маркетплейсов","confirmBillable":true}`

One second Case08 snapshot is authorized. If material doubt remains after it, Main Chat must amend the case before any third request. Case09 remains closed.

Case08 terminal closure:
`docs/seo/M10C_CASE08_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `4b34f2b307328df405803f7f08506ece482f725d`.

```text
CASE08_SNAPSHOTS = 2
CASE08_TERMINAL_EVIDENCE_STATE = STABLE_MIXED_OWNED_AND_EXTERNAL_ANALYTICS_SINGLE_SOURCE_SYNTHESIS
CASE08_ESTIMATED_PROVIDER_COST_RUB = 10.16
```

Cumulative paid GenSearch through Case08:
```text
PAID_REQUESTS = 13
ESTIMATED_COST_RUB = 66.04
```

Case09 snapshot-1 release:
`docs/seo/M10C_CASE09_SNAPSHOT01_RELEASE_2026-09-24_R1.md`
blob `2cfeb348fb47c9331f47d7d61868f81cf16b9ea5`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"ии для аналитики маркетплейсов","confirmBillable":true}`

Exactly one Case09 provider request is authorized. Quality-priority rule remains active; Case10 remains closed.

Case09 snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE09_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `a8951faaea116b17033b46fcad1bfa01b3d4d2d8`.

Case09 snapshot-1 assessment:
`docs/seo/M10C_CASE09_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `3d19660a49488a4fbd3eed00e6a639a92619fe72`.

Case09 snapshot-2 release:
`docs/seo/M10C_CASE09_SNAPSHOT02_RELEASE_2026-09-24_R1.md`
blob `0e3fb08e6611253b22f1e1e5c24d63b9380a3833`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"ии для аналитики маркетплейсов","confirmBillable":true}`

One second Case09 snapshot is authorized. If material doubt remains after it, Main Chat must amend the case before any third request. Case10 remains closed.

Case09 terminal closure:
`docs/seo/M10C_CASE09_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `87aa9b11da42e7451119847c0181cd88752f9f40`.

```text
CASE09_SNAPSHOTS = 2
CASE09_TERMINAL_EVIDENCE_STATE = STABLE_OWN_STORE_AI_ANALYTICS_LEAN_WITH_MIXED_ACCESS_MODES
CASE09_ESTIMATED_PROVIDER_COST_RUB = 10.16
```

Cumulative paid GenSearch through Case09:
```text
PAID_REQUESTS = 15
ESTIMATED_COST_RUB = 76.20
```

Case10 snapshot-1 release:
`docs/seo/M10C_CASE10_SNAPSHOT01_RELEASE_2026-09-24_R1.md`
blob `14983661f8ebf0c4dcc8ba9f831f415b809bc614`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"ии ассистент для маркетплейсов","confirmBillable":true}`

Exactly one Case10 provider request is authorized. Quality-priority rule remains active; Case11 remains closed.

Case10 snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE10_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `a53ad4ada73a15492daeb65af938928b20c7e26b`.

Case10 snapshot-1 assessment:
`docs/seo/M10C_CASE10_SNAPSHOT01_ASSESSMENT_2026-09-24_R1.md`
blob `85e5fc4c4353b69dc10005f68fb2246c19c6f64a`.

Case10 snapshot-2 release:
`docs/seo/M10C_CASE10_SNAPSHOT02_RELEASE_2026-09-24_R1.md`
blob `822733855e94fc3511190e63743979055bdb25fa`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"ии ассистент для маркетплейсов","confirmBillable":true}`

One second Case10 snapshot is authorized. If material doubt remains after it, Main Chat must amend the case before any third request. Case11 remains closed.

Case10 raw snapshot-2:
`docs/seo/evidence/m10c/M10C_CASE10_SNAPSHOT02_SEARCH_RESULT_V1.json`
blob `dfa03c7fe3216bc1912c99e70cccb7f108b23af2`.

Case10 terminal closure:
`docs/seo/M10C_CASE10_TERMINAL_CLOSURE_2026-09-24_R1.md`
blob `77181ac45e47757115fd1bd389964e58ba13523a`.

```text
CASE10_SNAPSHOTS = 2
CASE10_TERMINAL_EVIDENCE_STATE = BYTE_STABLE_THIRD_PARTY_AI_ASSISTANT_PRODUCTS
CASE10_ESTIMATED_PROVIDER_COST_RUB = 10.16
```

Cumulative paid GenSearch through Case10:
```text
PAID_REQUESTS = 17
ESTIMATED_COST_RUB = 86.36
```

Case11 snapshot-1 release:
`docs/seo/M10C_CASE11_SNAPSHOT01_RELEASE_2026-09-25_R1.md`
blob `a2f67b256ce7bee57f4e51f7bda57512a1334304`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"ии агент для wildberries","confirmBillable":true}`

Exactly one Case11 provider request is authorized. Quality-priority rule remains active; Case12 remains closed.

Case11 snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE11_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `288ca0f5235ec3646587da858fdc601f0b40e59c`.

Case11 snapshot-1 assessment:
`docs/seo/M10C_CASE11_SNAPSHOT01_ASSESSMENT_2026-09-25_R1.md`
blob `53d61cd6827ef5cba683289db18cb6121e75c22f`.

Case11 snapshot-2 release:
`docs/seo/M10C_CASE11_SNAPSHOT02_RELEASE_2026-09-25_R1.md`
blob `68124cd690e8b978b0ce24f8643b876bc1aaaba1`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"ии агент для wildberries","confirmBillable":true}`

One second Case11 snapshot is authorized. If material doubt remains after it, Main Chat must amend the case before any third request. Case12 remains closed.

Case11 raw snapshot-2:
`docs/seo/evidence/m10c/M10C_CASE11_SNAPSHOT02_SEARCH_RESULT_V1.json`
blob `01c7fac78f0b3c2772e9f5e830ee636e629734cb`.

Case11 terminal closure:
`docs/seo/M10C_CASE11_TERMINAL_CLOSURE_2026-09-25_R1.md`
blob `03a1a1e840bb9057efb5b26bde174139470d415c`.

```text
CASE11_SNAPSHOTS = 2
CASE11_TERMINAL_EVIDENCE_STATE = STABLE_THIRD_PARTY_AUTONOMOUS_AGENT_WITH_REPEATED_BYO_LLM_SIGNAL
CASE11_ESTIMATED_PROVIDER_COST_RUB = 10.16
```

Cumulative paid GenSearch through Case11:
```text
PAID_REQUESTS = 19
ESTIMATED_COST_RUB = 96.52
```

Case12 snapshot-1 release:
`docs/seo/M10C_CASE12_SNAPSHOT01_RELEASE_2026-09-25_R1.md`
blob `1c77e9dae41b2e69be2e1bed1d6a231d48d294f4`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"отчет маркетплейса вайлдберриз","confirmBillable":true}`

Exactly one Case12 provider request is authorized. Quality-priority rule remains active; Case13 remains closed.

Case12 snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE12_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `707a4f63595a005469b3066005e578bc0f38a13e`.

Case12 snapshot-1 assessment:
`docs/seo/M10C_CASE12_SNAPSHOT01_ASSESSMENT_2026-09-25_R1.md`
blob `9a1c3fcbe3048605b4cd63586729625ad8db6860`.

Case12 snapshot-2 release:
`docs/seo/M10C_CASE12_SNAPSHOT02_RELEASE_2026-09-25_R1.md`
blob `8356ecdef377ba7c35218a003298883f73e17f0c`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"отчет маркетплейса вайлдберриз","confirmBillable":true}`

One second Case12 snapshot is authorized. If material doubt remains after it, Main Chat must amend the case before any third request. Case13 remains closed.

Case12 raw snapshot-2:
`docs/seo/evidence/m10c/M10C_CASE12_SNAPSHOT02_SEARCH_RESULT_V1.json`
blob `d2aa5879577077e7d72cf54d3b7e96427a143c2c`.

Case12 terminal closure:
`docs/seo/M10C_CASE12_TERMINAL_CLOSURE_2026-09-25_R1.md`
blob `13860e1de07cdefd339e03b3553bdb0deb64d294`.

```text
CASE12_SNAPSHOTS = 2
CASE12_TERMINAL_EVIDENCE_STATE = STABLE_THIRD_PARTY_REPORT_FINANCIAL_RECONCILIATION_MIX
CASE12_ESTIMATED_PROVIDER_COST_RUB = 10.16
```

Cumulative paid GenSearch through Case12:
```text
PAID_REQUESTS = 21
ESTIMATED_COST_RUB = 106.68
```

Case13 snapshot-1 release:
`docs/seo/M10C_CASE13_SNAPSHOT01_RELEASE_2026-09-25_R1.md`
blob `ddc31cd602f52a36616943e379f2996e5dc049a8`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"дрр wildberries","confirmBillable":true}`

Exactly one Case13 provider request is authorized. Quality-priority rule remains active; Case14 remains closed.

Case13 snapshot-1 raw evidence:
`docs/seo/evidence/m10c/M10C_CASE13_SNAPSHOT01_SEARCH_RESULT_V1.json`
blob `ebffc843ea44fb2290bb85b3b5dc9fc0456ee8ce`.

Case13 snapshot-1 assessment:
`docs/seo/M10C_CASE13_SNAPSHOT01_ASSESSMENT_2026-09-25_R1.md`
blob `f13ee2817dcaf73274b209fa35fb10e5f0be8b67`.

Case13 snapshot-2 release:
`docs/seo/M10C_CASE13_SNAPSHOT02_RELEASE_2026-09-25_R1.md`
blob `5f0f6b83436597ed5f1c5bdf5c6c04a79a7ba580`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"дрр wildberries","confirmBillable":true}`

One second Case13 snapshot is authorized. If material doubt remains after it, Main Chat must amend the case before any third request. Case14 remains closed.

Case13 raw snapshot-2:
`docs/seo/evidence/m10c/M10C_CASE13_SNAPSHOT02_SEARCH_RESULT_V1.json`
blob `541eed3b5e5ccf6be5d00f27ec6d6d243100d717`.

Case13 terminal closure:
`docs/seo/M10C_CASE13_TERMINAL_CLOSURE_2026-09-25_R1.md`
blob `37ab3acbd51a641d25a4ce2d924d2ef2432503f1`.

```text
CASE13_SNAPSHOTS = 2
CASE13_TERMINAL_EVIDENCE_STATE = STABLE_THIRD_PARTY_EDUCATIONAL_DRR_MEASUREMENT
CASE13_ESTIMATED_PROVIDER_COST_RUB = 10.16
```

Cumulative paid GenSearch through Case13:
```text
PAID_REQUESTS = 23
ESTIMATED_COST_RUB = 116.84
```

Case14 snapshot-1 release:
`docs/seo/M10C_CASE14_SNAPSHOT01_RELEASE_2026-09-25_R1.md`
blob `4a73de48b756e077b387ac44bc67e49d609080b6`.

Current authorized action:
`SEARCH_API_V1 {"method":"genSearch","queryText":"отчеты маркетплейсов","confirmBillable":true}`

Exactly one Case14 provider request is authorized. Quality-priority rule remains active; Case15 remains closed.
