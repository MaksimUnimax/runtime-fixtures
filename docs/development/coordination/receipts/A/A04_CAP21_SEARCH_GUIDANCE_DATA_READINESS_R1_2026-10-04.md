# A04 CAP-21 search guidance data-readiness R1 — 2026-10-04

Task: `A04-CAP21-SEARCH-GUIDANCE-DATA-READINESS-R1-20261004`

Fresh source base: `08228e8ac1d584a1ac8552097558ea136fe05786`.

Evidence level: **SOURCE / LOCAL COMPOSED PACKAGE only**.

## Reproduced gap

The canonical CAP-21 row was still
`PASS_WITH_RECOVERY_AND_DATA_READINESS_GUIDANCE_GAP`.

Accepted source evidence already established that:
- `product_queries` is the Ozon provider search-fact source;
- `product_content_rating` is own-card content context, not a search-metric source;
- provider query/frequency/position values are facts only when returned;
- AI-created wording suggestions are a separate class and are never provider facts;
- missing provider metrics remain incomplete rather than zero;
- a returned provider set is not proof of an exhaustive semantic query universe;
- runtime entitlement/preflight remains authoritative for period/subscription availability.

Before the fix the composed guidance card for `product_queries` had
`scenario_context === null`. The genuine RED is preserved at:
`/root/octoport-control/logs/A/a04-cap21-search-guidance-data-readiness-r1-20261004/RED_COMPOSED.log`.

Two earlier local invocations did not reach the product assertion because of a
wrong build-path argument and a missing evidence-log directory. They are not
acceptance evidence.

## Change

The existing CAP-16 entitlement and CAP-18 guidance architecture is preserved.

Only the composed application patch adds CAP-21 metadata for:
- `product_queries` → `PROVIDER_SEARCH_FACTS`;
- `product_content_rating` → `OWN_CARD_CONTENT_FACTS`.

Both cards expose the accepted composite `product/search_text` context and
explicit policies:
- `QUERY_FREQUENCY_POSITION_ONLY_IF_RETURNED`;
- `SEPARATE_NOT_PROVIDER_FACTS`;
- `INCOMPLETE_NOT_ZERO`.

`product_queries.data_readiness` explicitly says:
- direct response;
- no automatic continuation;
- provider facts are bounded to returned rows;
- the result is not an exhaustive semantic query universe;
- AI suggestions are not provider facts;
- runtime entitlement is authoritative.

`product_content_rating.data_readiness` explicitly says that it contains no
search metrics and is only own-card content context for recommendations.

No provider request shape, template, transport, retry, privacy, admission,
entitlement rule or execution eligibility changed. Frozen imported Ozon bytes
remain unchanged.

## Canonical readiness

CAP-21 remains **QUALIFIED_PASS**, now under:
`PASS_WITH_RECOVERY_AND_EXPLICIT_DATA_READINESS_GUIDANCE`.

The current explicit `GUIDANCE_GAP` list therefore contains CAP-16 only.
Aggregate status counts remain:
- CLEAN_PASS 26;
- QUALIFIED_PASS 16;
- PARTIAL 1;
- REOPENED 1;
- IN_PROGRESS 1.

## Verification

PASS:
- imported baseline: 232 imported files, 0 source-byte changes;
- focused CAP-21 test on composed source runtime;
- focused CAP-21 test on extracted package;
- existing CAP-16 entitlement regression on source + extracted;
- existing CAP-18 data-readiness regression on source + extracted;
- Ozon capability-status boundary;
- JSON parse / Python compile / Node syntax / `git diff --check`;
- supervised `extension_core`: **153 gate processes PASS**, source + extracted,
  `live_provider_calls=0`, installed acceptance false;
- resource job `b95d5d654e194cc0bbcdc04219af1e6f`: exit 0,
  peak 124 MiB, OOM 0, cleanup verified.

Compact evidence:
- `/root/octoport-control/logs/A/a04-cap21-search-guidance-data-readiness-r1-20261004/BASELINE_VERIFY.json`;
- `/root/octoport-control/logs/A/a04-cap21-search-guidance-data-readiness-r1-20261004/EXTENSION_CORE_SUMMARY.json`;
- `/root/octoport-control/resource-jobs/b95d5d654e194cc0bbcdc04219af1e6f/receipt.json`.

## Limits

This result does **not** prove live Ozon search entitlement, live provider
values, exhaustive search coverage, AI semantic usefulness, ordinary
authentication, installed-browser behavior, LIVE_OWNER, store submission,
deployment or production.

No provider, browser, DB, service or live mutation was performed by this task.
