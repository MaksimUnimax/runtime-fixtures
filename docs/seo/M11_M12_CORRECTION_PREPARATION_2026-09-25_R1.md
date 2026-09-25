# Octoport SEO — M11/M12 provider-free correction preparation — 2026-09-25 R1

Status: **CORRECTION PREPARATION COMPLETE / NO PROVIDER / NO WORK / NO SITE MUTATION**
Repository: `MaksimUnimax/runtime-fixtures`
Branch: `seo/wordstat-batch-01-2026-09-16`
START_HEAD: `1aa322ffcd32b0d825074ad178b63a7494a13a20`

## Trigger

Fresh external audit after M11/M12 acceptance found two bounded consistency defects:

1. M11 classified existing HOME as `KEEP`, while accepted M12 requires a changed Title, first-screen SEO clarification and new internal-link responsibility. Under project methodology this is `OPTIMIZE`, not KEEP.
2. M12 retained the metaphorical HOME H1 as the target H1. Current search-engine guidance favors a prominent main heading that clearly communicates page purpose. The accepted Search job is connector intent: `подключить ии к маркетплейсу`.

This is not a semantic/owner architecture failure:
- page_owner_id does not change;
- cluster assignment does not change;
- IA does not change;
- pairwise Search evidence does not change;
- 102 HOLD clusters remain HOLD;
- planned analytics page owner does not change.

## Two-level authority read

LEVEL 1:
- `docs/seo/LEVEL1/README.md` blob `4c3a30644ac736b926ec82bba6b1a6e33434ac06`
- `docs/seo/EXECUTION_RULES.md` blob `4e999af4826d6f72fd15f481a698f674c8ed2d5c`

Applicable LEVEL 2:
- `docs/seo/LEVEL2/M9_M11_CLUSTER_IA_RULES.md` blob `2f87943fbe9037c58276d2dd3a805d070bd070a4`
- `docs/seo/LEVEL2/M12_PAGE_SPECS_CONTENT_RULES.md` blob `0e0f78cfe7d51bf4e5b6925699ba07eb98890c2b`

Historical accepted authorities remain immutable:
- M11 R1 acceptance blob `972f35818e3a7e39ca7cd2b690a13d6ddb1f7c06`
- M12 R1 acceptance blob `1779d00010f9964ccfefbf1830ee9cd2c75c6b75`

## External-method basis

Freshly checked immediately before correction:
- Yandex Title guidance:
  https://www.yandex.com/support/webmaster/en/search-results/title
- Yandex presenting information:
  https://yandex.com/support/webmaster/en/recommendations/presentation
- Google Search Essentials:
  https://developers.google.com/search/docs/essentials

Supported correction:
- an accepted SEO change to Title/internal linking/content target means physical action is OPTIMIZE;
- page purpose should be immediately clear in prominent content;
- search-language wording may be used naturally in the main heading when it accurately describes the page.

## Exact correction scope

M11:
```text
PAGE_OWNER_ID = M11PAGE_EXISTING_HOME
CLUSTER_ID = M9CL_3f05678ef9d62960

physical_action:
KEEP -> OPTIMIZE

existing surface decision:
SEO_OWNER_KEEP -> SEO_OWNER_OPTIMIZE
```

M12:
```text
HOME physical_action:
KEEP -> OPTIMIZE

HOME H1 target:
Ваш ИИ получает руки для работы с маркетплейсами.
->
Подключите ваш ИИ к Ozon и Wildberries

HOME subheadline target:
Ваш ИИ получает руки для работы с маркетплейсами.
```

The subheadline is a messaging role, not an additional SEO target.

## Dependency reconciliation

Affected:
- current M11 cluster final ownership snapshot;
- current M11 page owner registry snapshot;
- current M11 existing-surface decision snapshot;
- M11 current acceptance/progress pointer;
- M12 page spec registry;
- M12 HOME hero block contract;
- M12 current acceptance/progress pointer.

Unchanged:
- M9 evidence;
- M10A;
- M10D;
- owner IDs;
- cluster set;
- 5,356 pairwise decisions;
- 1,399 material HOLD boundaries;
- IA edges;
- cannibalization guards;
- analytics planned URL/title/H1/spec;
- M12 proof requirements;
- 102 HOLD clusters.

## Work/provider decision

```text
WORK_REQUIRED = false
PROVIDER_CALLS = 0
WEB_ACQUISITION_FOR_SEMANTIC_EVIDENCE = 0
SITE_MUTATIONS = 0
```

Reason: deterministic correction affects one existing owner and one page spec; full current authority is small and can be verified in Main Chat without sampling.

## Hard QA

- all 104 M11 cluster rows preserved;
- exactly one changed M11 cluster field: HOME physical_action KEEP -> OPTIMIZE;
- all 2 owner rows preserved;
- exactly one owner physical_action changed;
- exactly one existing-surface decision changed;
- M11 owner IDs/IA/pairwise/HOLD universe unchanged;
- M12 spec remains exactly 2 rows;
- analytics spec byte-equivalent across all fields;
- HOME owner/query/URL/coverage remain unchanged;
- HOME physical_action = OPTIMIZE;
- HOME H1 target = `Подключите ваш ИИ к Ozon и Wildberries`;
- HOME subheadline role preserves prior metaphor;
- no held cluster imported;
- no site mutation.

M13 remains blocked until corrected current authorities are read back and accepted.
