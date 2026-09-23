# Octoport SEO — M8 progress

Date: 2026-09-23
Status: **RELEASED / WAITING CHATGPT WORK RETURN**
Branch: `seo/wordstat-batch-01-2026-09-16`
Current HEAD: `8ae4b0529e1d95bd2bc859099ea99e05cceafe9d`

## Current accepted chain

```text
M0 = PASS
M1 = PASS / PRELAUNCH_NO_PRODUCTION_SITE
M2 = PASS CURRENT AUTHORITY
M3 = PASS CURRENT HARDENED AUTHORITY
M4 = ACCEPTED WITH DECLARED M4Q LIMITATION
M5 = ACCEPTED HYPOTHESIS ONLY
M6 = PASS
R4 = PASS
M7 = PASS / SEARCH-SIDE FREEZE
M8 = RELEASED TO WORK
```

## M7 freeze

Frozen input HEAD:
`3b71060bf529c67c7f3578ca6bfb268407e72b0b`

Freeze manifest:
`docs/seo/M7_SEARCH_SIDE_FREEZE_MANIFEST_2026-09-23_R1.json`

Freeze manifest blob:
`3cc09a62aa4ac4bed0af44939a9be63820657219`

## M8 release

Pre-handoff:
`docs/seo/M8_SEARCH_ONLY_SEMANTIC_MASTER_PRE_HANDOFF_2026-09-23_R1.md`

Pre-handoff blob:
`7685fc0af3672e487639cb2666883ec222a1c355`

Canonical Work prompt:
`docs/seo/M8_SEARCH_ONLY_SEMANTIC_MASTER_WORK_PROMPT_2026-09-23_R1.md`

Prompt blob:
`d84674ee3f25e3d5a0f0349778033074e0793113`

## Work contract

```text
RAW_SOURCE_OCCURRENCES = 25229
M2R = 1123
M4Q_QUERY_UNIVERSE = 15542
M4C_CANDIDATES = 8431
TARGETED_DELTA = 133

OUTPUT_FILES = 9
ALICE_INPUT_ROWS = 0
PROVIDER_CALLS = 0
WEB_ACQUISITION = 0
GITHUB_WRITES_BY_WORK = 0
M9_CLUSTERING = NOT_AUTHORIZED
```

## Owner relay

Run the canonical prompt in ChatGPT Work.

Work must return one ZIP containing exactly 9 final files.

Owner staging path after Work return:
`docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R1/`

Exact GitHub UI upload URL:
`https://github.com/MaksimUnimax/runtime-fixtures/upload/seo/wordstat-batch-01-2026-09-16/docs/seo/work_return/M8_SEARCH_ONLY_SEMANTIC_MASTER_2026-09-23_R1/`

After upload:
`MAIN CHAT REMOTE READBACK -> FULL QA -> ACCEPT | REWORK | HOLD`.
