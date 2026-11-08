# CAP19 WB FBS stock identity bridge v1

Author: existing B. Intended consumer: existing A, through the coordinator.
Status: AUTHOR SOURCE CANDIDATE, independent qualification pending.

This separate pure function prepares the FBS stock side of a future CAP19 pair.
It does not modify the six accepted WB warehouse paired-data files at commit
`7274b1187bc25b8cc4a9bdaaa999f0ab3158a27d`, which A is applying separately.
It does not add FBS acceptance to that commit or feed FBS rows into its
`WB_WAREHOUSE_ON_HAND` validator. Ozon, provider capture, runtime integration,
advertising attribution, owner semantics/B22 and full CAP19 remain open.

## Retained source and exact identity edges

The manifest pins the complete existing `wb-catalog-identity-field-schema-slice-v1.json`
and `wb-stock-field-schema-slice-v1.json`, both dated 2026-09-27. No provider
documentation was refreshed for this candidate. The source records establish:

- `cards_list`, POST `/content/v2/get/cards/list`: `cards[].nmID` is a product;
  `cards[].sizes[].chrtID` is a size. SKU/barcode and vendor code are not these IDs.
- `seller_warehouses`, GET `/api/v3/warehouses`: `id` is a seller warehouse;
  `officeId` is a distinct linked office ID.
- `fbs_stocks`, POST `/api/v3/stocks/{warehouseId}`: the path selects seller
  warehouse `id`; request `chrtIds` selects sizes; `stocks[].chrtId/amount`
  supplies size/on-hand units. No product ID is claimed in that stock response.

The bridge validates the catalog size-to-product relation and requires it to be
unambiguous across the supplied catalog. This is a checked precondition, not a
claim that the provider schema guarantees globally unique size IDs. It keeps
the seller-warehouse namespace as `sellerWarehouseId`; it never substitutes
`officeId`, a WB warehouse ID, a barcode or a label.

## Input contract

`bridgeFbsStock` accepts JSON-shaped data with exact schema
`cap19_wb_fbs_stock_bridge_v1`, `synthetic: true`, `marketplace: WB` and stock
scheme `WB_SELLER_WAREHOUSE_FBS`. All fixture rows are synthetic.

The caller explicitly selects products, their sizes and seller warehouses. For
each selected warehouse, v1 requires exactly one complete request/response and
the full selected size set. Every warehouse × size cell must be present, even
at zero. Batched/merged multi-request captures are outside v1. Missing rows are
incomplete; absence is never normalized to zero. Extra selected products/sizes,
duplicate identities, undeclared cells and ambiguous catalog mappings reject.

`complete`, `asOf`, selection and the response wrapper `warehouseId` are caller
capture metadata, not invented provider response fields. The wrapper must be
bound to that exact request path by a future capture layer. Equal `asOf` strings
and true flags are checked declarations, not proof of atomic capture, completed
pagination or unchanging live catalog. The caller must provide the completed
catalog cursor chain, warehouse list and exact FBS request set before runtime
use. These live facts are not established by this synthetic bridge.

All three sources must declare the exact `context.stockAsOf` and
`Europe/Moscow`. Timestamps are valid second-precision `+03:00` instants. This
is a point snapshot, so it does not impose a daily-period rule. A future join to
daily advertising statistics must independently retain whole-day coverage,
period-end snapshot binding, currency and statistics-versus-cost distinctions.
The FBS schema does not document a freshness SLA; no TTL is invented here.

Technical v1 input bounds: at most 100 selected warehouses, 1000 products,
1000 selected sizes in total, 10000 selected cells, 1000 catalog cards and
10000 catalog sizes. All IDs are positive safe integers; quantities and totals
are nonnegative safe integers. These are synthetic helper limits, not applied
runtime memory/resource caps or provider maxima.

## Output and validation

Success is `FBS_STOCK_IDENTITY_SYNTHETIC_VALID`, with sorted product/size/warehouse
IDs, detached selected stock cells, product totals and one overall total.
The fixture has 90001=12 units, 90002=0, 90003=4, eight cells and 16 units.
This is an AUTHOR oracle only. Independent expected calculation remains pending.

`outOfStockInSelection` means the complete selected sum equals zero, not that a
product is unavailable everywhere. No business low-stock threshold, monetary
amount, campaign membership or spend allocation is produced. Input fields
outside the stock identity contract are not copied into the output. The pure
function neither mutates caller data nor retains its mutable arrays.

Run the bounded standalone test file:

```sh
node --test tests/regression/extension-core/cap19-wb-fbs-stock-bridge-v1.test.mjs
```

Tests check full author output, identity namespaces, exact selected-cell
coverage, explicit zeros, ambiguity/duplicate/type/quantity/size boundaries,
snapshot declarations and nonmutation. No runtime API calls, new credentials,
installed behavior or full paired advertising × FBS acceptance are claimed.
The coordinator retains the single existing independent review queue.
