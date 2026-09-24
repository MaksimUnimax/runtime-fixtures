# Octoport SEO — M10C GenSearch first paid case release — 2026-09-24 R1

Status: **RELEASED / EXACTLY ONE PAID GENSEARCH SNAPSHOT**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream acceptance:
`docs/seo/M10B_MAIN_CHAT_ACCEPTANCE_2026-09-24_R1.md`
blob `e35c5a8b58e3e9e34c375938a7593ffa6deb85b6`.

Installed-runtime probe receipt:
`docs/seo/M10C_GENSEARCH_CAPABILITY_PROBE_RECEIPT_2026-09-24_R1.md`
blob `31fa4dced95ddc3d505c908d68142e7a92f3d1b1`.

Provider/Bridge preflight:
`docs/seo/M10C_GENSEARCH_PROVIDER_BRIDGE_PREFLIGHT_2026-09-24_R1.md`
blob `337f984e3da0218ed8fae0e745bf6802aba1a3bc`.

## Released case

```text
CASE_ID = M10BCASE_e5e5533784063649
SOURCE_M5_HYPOTHESIS = M5H00001
EXACT_AI_PROMPT = ии помощник селлера
PROMPT_SOURCE_CLASS = EXACT_CURRENT_SEARCH_QUERY
PROMPT_SOURCE_REF = M4QR2Q00028
PRIMARY_CLUSTER = M9CL_f0e07ec6b2f588c0
MARKETPLACE_SCOPE = MARKETPLACE_UNSPECIFIED
TASK_SCOPE = seller-owned chat assistance versus a human manager, autonomous agent, or native marketplace bot
```

## Exact command

```text
SEARCH_API_V1 {"method":"genSearch","queryText":"ии помощник селлера","confirmBillable":true}
```

## Provider budget

Official tariff freshly checked 2026-09-24:
```text
GENSEARCH_RUB_PER_1000 = 5080
GENSEARCH_RUB_PER_REQUEST = 5.08
RELEASED_PROVIDER_REQUESTS = 1
RELEASED_MAX_COST_RUB = 5.08
```

## Execution contract

Exactly one manual action is authorized.

Expected successful evidence envelope:
```text
PREFIX = SEARCH_RESULT_V1
service = search
operation = genSearch
status = OK
request_executed = true
automatic_retry = false
result.mode = generative
```

Capture in full:
- exact command;
- request_id;
- http_status;
- elapsed_ms;
- cost_estimate;
- message content and role;
- all sources URL/title/used;
- all searchQueries text/reqId;
- fixedMisspellQuery;
- isAnswerRejected;
- isBulletAnswer;
- hints;
- problematicAnswer;
- transport wire_format/frame_count.

## Stop / retry rules

```text
AUTOMATIC_RETRY = FORBIDDEN
MANUAL_REPEAT_ON_ERROR = FORBIDDEN
MANUAL_REPEAT_ON_UNKNOWN = FORBIDDEN
SECOND_SNAPSHOT = NOT AUTHORIZED
NEXT_CASE = NOT AUTHORIZED
```

If request crosses provider boundary (`request_executed=true`), never resend this case without a separate Main Chat decision, even if parsing/delivery fails.

If `request_executed=false`, preserve the exact local rejection and return to Main Chat.

After receipt, Main Chat persists/readbacks raw evidence, evaluates whether it is SUCCESS / VALID_PARTIAL / FAILURE / UNKNOWN under the accepted case contract, and only then decides the next case.

M10D remains blocked.