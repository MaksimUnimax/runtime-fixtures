# CAP19 WB statistics × FBS synthetic pair v1

Author: existing B. Consumer: existing A through the coordinator.
Status: AUTHOR SOURCE CANDIDATE; independent composition qualification pending.

This pure source-only composition pairs normalized product-attributed promotion
statistics with selected FBS stock. It preserves the accepted helpers at
`7274b1187bc25b8cc4a9bdaaa999f0ab3158a27d` and
`8b212046d8f54c562dd176e28fd4992f48a67426`. Their independent acceptance does
not automatically accept this new composition. It changes five new files only;
A/C consumers, readiness TSV, gold definitions and frozen source remain intact.

Canonical PLAN blob `983bfc0bac0641706244d31bd62d36684b8e16b6`, B20/B29,
preserves methods/fields, period/units/IDs, completeness and cross-source joins.
This technical synthetic preparation does not perform business-answer tuning,
which remains after technical B22. Ozon, provider capture, browser/runtime,
installed behavior, actual-cost attribution and full CAP19 remain open.

## Exact input and applicable source boundary

`composeStatisticsFbs(input)` requires `cap19_wb_statistics_fbs_pair_v1`,
`synthetic: true`, marketplace `WILDBERRIES`, an explicit product/size/seller-
warehouse selection, normalized `statistics` and the original synthetic `fbs`
input. The unchanged `bridgeFbsStock` validates the FBS input before its output
is joined. Seller-warehouse IDs retain `WB_SELLER_WAREHOUSE_FBS` and
`sellerWarehouseId`; they are never replaced by WB warehouse or office IDs.

The statistics input is a deliberate product-level normalization boundary:

- `sourceSchemaVersion: cap19_wb_paired_data_v1`, strict `complete: true`;
- `context`: period, timezone, currency, membershipAsOf and comparison;
- measure `PRODUCT_ATTRIBUTED_STATISTICS_NOT_ACTUAL_COST`, currency, total;
- unique campaign totals `(advertId, currency, amount)`;
- unique products `(nmId, statisticsSpend, statisticsComponents, activeCampaignIds)`;
  components are unique `(advertId, amount)` within each product.

The fixture takes those exact fields from the retained independently checked
WB projection and original campaign totals. The test checks the normalization
against the unchanged accepted producer on its original full input. The
composition does not need or use that producer's FBW stock quantities. It does
not reparse raw `day/appType` rows; their upstream daily-grain validation is
outside this normalized interface. A real capture/normalization producer still
needs its own binding. Schema names, true completeness and supplied timestamps
are caller declarations, not runtime/provider or tenant attestations.

The full original source pins and both immutable helper identities are listed
in the manifest. Retained field-schema records are dated 2026-09-27 and were
not refreshed. Both independent expected boundaries are retained by exact hash:
WB 4336 B / `1e9aa9a514b6159224442f85c5929e8e0ba498f92a8d0c26ac25e26f5f7a6fc3`;
FBS 2120 B / `af41a2b1378b021933f70bb2cf79829dbd677f31922d12b93986706bbc4e5dc6`.
The new `authorExpected` is an author composition oracle, not a new independent
expected table or qualification.

## Coverage, time and money

The outer selection and statistics product set must match exactly. FBS must
match the same product/size selection and the exact seller-warehouse set.
Duplicates, missing/extra products or sizes and conflicting size ownership
reject. Statistics components, campaign totals, product totals and overall total
must reconcile exactly. Campaign membership never creates a monetary component.
Inactive-at-snapshot campaigns may retain explicitly supplied historical spend.
An explicit zero component and explicit zero FBS cells are valid; missing data
or false/unknown completeness is `INCOMPLETE` and never inferred as zero.

The comparison is `PERIOD_STATS_WITH_END_SNAPSHOT_NOT_HISTORICAL_STOCK`.
Statistics use `Europe/Moscow`, `RUB` and a positive half-open period of one
through 31 whole days. Both boundaries must be valid midnight `+03:00` instants.
Sub-day boundaries reject without prorating. Membership and FBS stock snapshots
must equal `endExclusive`. This is an end snapshot beside period statistics,
not a historical stock series, through-period membership or atomic live capture.
No undocumented FBS freshness TTL is invented.

Money uses canonical nonnegative decimal strings and BigInt cents, never binary
floating-point allocation. Normalized component/product totals may have up to
13 integer digits, but no value or aggregate may exceed
`1000 × 9999999999.99 = 9999999999990.00`. This follows the qualified producer's
1000 source-row/ten-integer-digit input boundary. No more than 1000 normalized
campaign/product components are admitted globally. Selected product and FBS
cell bounds remain 1000 products/sizes, 100 warehouses and 10000 cells.
These are finite source-helper limits, not an applied process memory budget.

## Output and author checks

Success is `STATISTICS_FBS_SYNTHETIC_PAIR_VALID`. Each product contains statistics
spend and campaign components once, beside its separate FBS stock cells.
No cell receives a spend field. A campaign can have several products without
its full total being copied to each one. Product and global stock totals come
from the checked FBS bridge; statistics totals come only from reconciled money.
Selection order does not affect sorted output. Outputs are detached from input.

The AUTHOR fixture gives:

| nmId | Statistics (RUB) | Selected FBS units |
|---|---:|---:|
| 90001 | 120.00 | 12 |
| 90002 | 30.00 | 0 |
| 90003 | 7.00 | 4 |

Statistics total is 157.00, with campaigns 125.50/24.50/7.00; FBS totals are
16 units / eight cells. `lowStock` remains null. Actual cost remains
`INCOMPLETE / CAMPAIGN_SPEND_PRODUCT_ALLOCATION_UNDEFINED`, with currency,
productCost and warehouseCost null. This function does not claim the actual-
cost source is complete and does not allocate it.

Run the bounded standalone author test:

```sh
node --test tests/regression/extension-core/cap19-wb-statistics-fbs-pair-v1.test.mjs
```

Checks cover exact full projection and qualified input normalization; compatible
and conflicting selections/identity/completeness/zeros; period/snapshot/currency;
exact money and reconciliation; namespace and no-multiplication; permutations,
input nonmutation and detached output; declared size/row limits. No provider,
DB, browser, B50, 13-case subset, PREP/GET, production or security action occurs.
The coordinator retains the existing single independent qualification queue.
