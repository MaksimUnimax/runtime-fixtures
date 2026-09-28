# Octoport HOME — capabilities + browser workflow R2

Date: 2026-09-28  
Status: OWNER-DIRECTED / IMPLEMENTED IN SOURCE

## Owner decisions implemented

1. Hero keeps the agreed AI-brand wording; WB and Ozon are rendered in marketplace brand colors.
2. The R1 proof/demo block is removed.
3. The page now explains browser-extension mechanics explicitly.
4. The separate “what is needed” compatibility block is removed.
5. The data-control block is shortened to local credentials + read-only safety.
6. The first block after the hero is the broad capability inventory for owner curation.
7. A separate strong-AI block explains cross-context analysis without claiming that Octoport itself supplies external intelligence.

## Capability inventory source

The capability cards are grounded in docs/product/readiness/BUSINESS_SCENARIOS.tsv and PRODUCT_TRUTH:
- sales and period comparisons;
- advertising campaigns and spend;
- available search analytics;
- stocks and turnover;
- product/card diagnostics;
- supplies, warehouses and logistics;
- orders, returns and cancellations;
- finance, accruals and deductions;
- prices and promotions;
- cross-section priority summaries;
- AI-side formatting into tables/graphs;
- AI-side summaries, reports and document drafts.

Cards use bounded wording: availability depends on marketplace API data, credential permissions and the selected AI interface.

## Setup path

The main page presents Opera, Chrome, Yandex Browser and Firefox as the target beta browser set, while store-card availability remains explicitly pending.

The API-key button routes to /install#api-keys.

Ozon guidance:
- Seller Client ID + API key;
- Admin read only for Seller API;
- separate Performance credentials for advertising analytics.

Wildberries guidance:
- current beta direct-local Personal token path;
- only needed data categories;
- access level “Только чтение”.

WB token guidance is consistent with the current official seller instructions, including category-scoped access and read-only tokens.

## Strong AI boundary

The strong-AI section may describe comparing seller-owned marketplace data with external context only when that context is supplied or acquired by the chosen AI itself. Octoport is not presented as an external competitor-intelligence provider, and causal conclusions remain bounded.
