# Octoport SEO — M10C progress

Date: 2026-09-24
Status: **GENSEARCH PREFLIGHT PASS / NON-BILLABLE CAPABILITY PROBE RELEASED**
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

Paid GenSearch remains closed until capability probe receipt is persisted/read back and a separate per-case release is issued.
