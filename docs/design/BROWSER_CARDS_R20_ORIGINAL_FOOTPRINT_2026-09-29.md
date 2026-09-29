# Browser cards R20 — restore original card footprint

Date: 2026-09-29

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

R20 corrects R19. The owner asked to replace the poor browser artwork, make the Octoport mark the same size as the browser icon, and center each card's content. The owner did **not** ask to enlarge the cards.

## Correction

The browser catalogue card footprint is restored to the exact pre-R19 layout rules from commit `3f56c947bff1268af70e7625852e930b1a0f6d69`:

- desktop >1020px: 4 columns, 16px gap, original 22px card padding;
- <=1020px: 2 columns;
- <=620px: 1 column;
- no R19 fixed/minimum card height;
- no R19 78px/66px icon enlargement.

Only the requested changes remain:

- full-color Chrome, Opera, Yandex Browser and Firefox artwork;
- browser and Octoport icon boxes are exactly equal at 42×42px;
- icon row, browser name, catalogue line and availability text are centered in each card.

## Measured footprint comparison

Pre-R19 baseline and R20 are the same:

- 1440 viewport: each card `298 × 237.40625` px;
- 900 viewport: each card `418 × 191.703125` px;
- 390 viewport: each card `358 × 189.40625` px.

Thus the card dimensions were restored; the visual changes are limited to icon artwork, equal icon sizing and centering.

## Source acceptance

- site regression suite: 41/41 PASS;
- local screenshots checked at 1440, 900 and 390;
- all browser/Octoport icon boxes are 42×42px;
- no horizontal overflow.

## Production acceptance

Production source commit: `d734239f76960b013a688ee4866e4eaf88685168`.
Live release: `/var/www/octoport-site/releases/d734239f76960b013a688ee4866e4eaf88685168`.
Rollback backup: `/var/backups/octoport-site/20260929T104017Z`.

Live measurements on `https://octoport.ru`:
- 1440: cards 298 × 237.40625 px, equal browser/Octoport icons 42 × 42 px;
- 900: cards 418 × 191.703125 px, equal browser/Octoport icons 42 × 42 px;
- 390: cards 358 × 191.703125 px, equal browser/Octoport icons 42 × 42 px;
- Chrome approved-copy/public-page run: 15 states / 48 disclosure interactions PASS;
- production TLS/redirect/security-header/app/API verification PASS.
