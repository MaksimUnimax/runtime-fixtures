# CAP19 WB paired data contract v1

Author: existing B. Consumer: existing A. Base: `c5d0ad95397c376928da7462d7606993e32fbbd4`.
Status: author source candidate; independent numeric table/review pending.

This technical candidate supplies one explicitly synthetic paired input for
CAP-19. It does not tune business answers or change accepted readiness/gold
definitions. Ozon, FBS, live capture, installation and owner semantic acceptance
remain open. No provider/AI/network operation is performed by the validator.

## Inputs and provenance

The adjacent machine-readable fixtures are:

- `cap19-wb-paired-data-contract-v1.json`: versioned normalization and grain rules;
- `cap19-wb-paired-data-fixture-v1.json`: `input` and a separate `authorExpected`;
- `cap19-wb-paired-data-manifest-v1.json`: exact four original source pins,
  applicability, artifact paths and independent reviewer task.

All are under `tests/regression/extension-core/fixtures/`. The original A source
fixtures are unchanged. Their source date is 2026-09-27; where recorded they pin
the existing WB SDK mirror commit `5057bdb9bf16dea24000e3ca79e1934f7761d7fe`.
This candidate does not refresh those provider facts.

Normalized rows are synthetic data, not samples of actual marketplace accounts.
`sourceRowRef` on cost history is an explicit synthetic capture reference, not
an invented provider field. JSON input contains no account/store credentials.

## Meaning of the pair

The synthetic reference period is `[2026-09-26T00:00:00+03:00,
2026-09-27T00:00:00+03:00)`, `Europe/Moscow`, statistics currency `RUB`.
Stock and campaign membership are a snapshot exactly at the period end. This
is a reproducible test context, not a new live request default, historical stock
claim or claim that snapshot membership persisted through the statistics period.

Campaign metadata identifies membership. Only status 9 means active at the
snapshot. Membership never supplies product-attributed spend. Such amounts come
only from the explicit `promo_fullstats` product/day/platform statistics rows;
the product sums must reconcile to each selected campaign's statistics total.
Campaign 1003 is inactive at the snapshot but still has historical statistics.

Each stock row is unique at `nmId/chrtId/warehouseId`. The declared product/size
selection crossed with the declared warehouse list defines the exact scope;
all cells, including zero cells, must be present. This is not all stock in the
store. Sum `quantity` once; keep transit separate. Output has one product row
with a list of stock cells and separate campaign statistics components. No spend
is placed on a size/warehouse row. Missing cells, incomplete pages, duplicate
grains, conflicting identities, currency/period mismatch and unsafe amounts
return `INCOMPLETE`, not zero or a partial successful total.

For the fixture, the AUTHOR table is:

| nmId | Statistics spend (RUB) | Selected on-hand units | Active campaign IDs |
|---|---:|---:|---|
| 90001 | 120.00 | 10 | 1001, 1002 |
| 90002 | 30.00 | 0 | 1001 |
| 90003 | 7.00 | 10 | none |

Statistics total is 157.00. These are author-provided oracle values; a reviewer
must calculate them independently from `input`, not accept this table as an
independent result. The complete stock cells/components remain in the fixture.

## Actual cost stays unresolved

The existing `promo_spend_history` source has campaign `advertId/updSum`, no
product attribution and no proven currency field. Synthetic cost rows are kept
separately with currency `null`; no total is labelled RUB or compared as the
same measure as statistics. The actual-cost × stock branch remains:

`INCOMPLETE / CAMPAIGN_SPEND_PRODUCT_ALLOCATION_UNDEFINED`.

`productCost` and `warehouseCost` remain null. No proportional allocation,
campaign-total copy, undocumented currency inference, low-stock threshold,
causal business conclusion or revenue/DRR calculation is introduced. This
preserves the accepted boundary while making statistics × selected stock
independently reviewable.

Partial cost history remains explicitly incomplete and does not block an
otherwise complete statistics × stock projection. The top-level success label
is `STATISTICS_STOCK_SYNTHETIC_PAIR_VALID`, not complete actual-cost acceptance.

## Validation and consumption

The pure `projectPair` export in
`tests/regression/extension-core/cap19-wb-paired-data-contract.mjs` accepts this
versioned synthetic scope only. Run the bounded standalone checks:

```sh
node --test tests/regression/extension-core/cap19-wb-paired-data-contract.test.mjs
node tests/regression/extension-core/cap19-wb-paired-data-contract.mjs
```

The CLI verifies source pins and the author oracle. Tests cover the paired
projection, no multiplication, exact cents, source incompleteness, temporal and
currency conflicts, identity/grain errors and nonmutation. They do not provide
an independent expected table. Existing core-contracts/CI, A/C source, readiness
TSV and the old gold definition index are deliberately not edited.

The existing independent Reviewer receives the exact candidate files, source
pins and `input`; it checks the table and negative boundaries. After that review,
A can consume the qualified technical pair within this scope. Integrating it
into a current extension/package and full CAP19 Ozon/WB semantic acceptance are
separate results. B50, DB5 and R15 native are not dependencies of these source
checks and are not executed here.
