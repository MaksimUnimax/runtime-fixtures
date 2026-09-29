# Seller Analytics R21 — selected business cases on analytics page and HOME

Date: 2026-09-29

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

## Owner selection

The three detailed examples on `/seller-analytics` are now:

1. keep the existing `Сравнить продажи за два периода` card;
2. replace the advertising-vs-stock card with the CAP-23 search-position case;
3. replace the report-preparation card with the CAP-24 monthly SKU unit-economics case.

The detailed CAP-23 card explains available search/query/product/position data, current positions and dynamics, and explicitly keeps missing data distinct from a zero position.

The detailed CAP-24 card uses seller terminology: SKU, unit economics, margin, marketplace fees, logistics, storage, advertising spend, profitability and marginal contribution. It explicitly does not call the result net profit when COGS, taxes or other external expenses are missing, and it does not invent an allocation for storage that cannot be assigned correctly.

The stale sentence promising two later real-check results was removed, because that old proof block was deleted in the prior change. The page lead now mentions sales, search positions, advertising, stock and finance.

## HOME short examples

The three cards in the `Сильная модель + Октопорт` example column are replaced with short versions of the same three selected cases:

- `Как изменились продажи?`
- `Где просели позиции в поиске?`
- `Какие SKU съедают маржу?`

The third short card explicitly says that unit economics includes revenue, commissions, logistics, storage and advertising, and reports marginal contribution after marketplace expenses.

## Production acceptance

Production source commit: `a59fb62716b0c6922ce59c82851723de4d88d500`.
Live release: `/var/www/octoport-site/releases/a59fb62716b0c6922ce59c82851723de4d88d500`.
Rollback backup: `/var/backups/octoport-site/20260929T110345Z`.

Live acceptance on `https://octoport.ru`:
- Chrome: 15 states / 48 disclosure interactions PASS;
- Opera: 15 states / 48 disclosure interactions PASS;
- Yandex Browser: 15 states / 48 disclosure interactions PASS;
- `/seller-analytics` contains the search-position and monthly unit-economics cards and no longer contains the replaced advertising-vs-stock/report cards;
- HOME contains the three short selected examples, including search positions and SKU unit economics.
