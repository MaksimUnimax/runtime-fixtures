# A04 CAP-25 search dedup fail-closed successor R1 — 2026-10-04

Task: A04-CAP25-SEARCH-DEDUP-FAILCLOSED-SUCCESSOR-R1-20261004
Fresh base: `de64e69350b63d658e82bda8f34d408af21fbcba`
Rejected predecessor: `239c3019f45dc89ac746d211f7a265a2d178fb51`
Evidence level: SOURCE / LOCAL_CONTRACT only.

## Why a successor was required

The predecessor correctly hardened `search_dedup` and passed its focused CAP-25 coverage test plus independent Luna review. Exact task-ref CI then rejected it in two independent workflows:

- Extension CI run `37181699420`, job `111375428314` (`Common core / source and package`);
- Extension I1-C1 run `37181699467`, job `111375432459` (`client-i1`).

Both failed at the same intentional guard in `business-scenario-gold-protocol.mjs`: the `search_dedup` binding is `EXECUTABLE_KIND`, so its canonical `caseIds` must exactly enumerate every numeric case of that kind. The predecessor added four negative executable cases but did not update the gold protocol fixture.

Registration `224eee28db4c5df15ec5dba14473fca231fba7f54905ff3e9f72bb2a502f4200` was governed-superseded and closed; its task ref was deleted. It never reached main.

## Fresh-base reconstruction

Fresh `origin/main` advanced from `c2831613` to `de64e693` only through a B03 documentation receipt. None of the CAP-25 calculator/numeric/gold paths changed.

The successor preserves the predecessor's accepted calculator and numeric-fixture bytes:
- missing/non-array rows -> `SEARCH_ROWS_MISSING`, `uniqueCount: null`;
- malformed/missing/blank/non-string `period/product/query` -> `SEARCH_BUSINESS_KEY_MISSING`, `uniqueCount: null`;
- valid key identity remains exact `period + NUL + product + NUL + query`;
- exact duplicates still collapse;
- `pageCountProvesCompleteness` remains `false`;
- empty `rows: []` behavior is unchanged and is not promoted to provider completeness evidence.

## Gold protocol reconciliation

The assertion in `business-scenario-gold-protocol.mjs` is unchanged.

Only its canonical fixture is reconciled:
- `numericBindings.search_dedup.caseIds` now enumerates all five cases:
  `search_dedup_business_key`, `search_dedup_period_missing`,
  `search_dedup_product_empty`, `search_dedup_query_non_string`,
  `search_dedup_rows_missing`;
- CAP-25/OZON definitions hash -> `b00dd54023df80cc2411b0cd5e7b79662e22f4a09e621f015770635939601e49`;
- CAP-25/WILDBERRIES definitions hash -> `14287e8439610217c351a3960ef310cb3c70aece0c96962683cfc949b2c6c150`;
- definition index SHA256 -> `a75029fa796b372d53819cde1d333bd6e0476e9f266646bd1614b6cbbcd0405f`.

## Verification

Authoritative Node: `v24.20.0`.

PASS:
- `business-scenario-coverage.mjs`: 45 scenarios, CAP-25 remains `IN_PROGRESS`, 62 numeric cases.
- `business-scenario-gold-protocol.mjs`: 45 scenarios × 2 marketplaces × 3 layers = 270 logical cards; definition index 90 rows with SHA256 `a75029fa...`.
- JSON parse of both modified fixtures.
- `git diff --check`.

A direct invocation of `core-contracts.mjs` without its mandatory runtime argument produced an argument error and is explicitly not acceptance evidence. The exact predecessor CI failure was inside the gold-protocol import and is closed by the focused gold-protocol PASS above; exact five GitHub CI remain mandatory before publication.

No dependency install, package rebuild, browser, auth, provider, marketplace, DB, service or live action was performed.

## Limits

CAP-25 remains `IN_PROGRESS`. This does not prove live search entitlement, monthly provider completeness, prior-month owner files, AI semantic quality, manual owner acceptance, package/browser behavior, LIVE_OWNER, deployment or production.
