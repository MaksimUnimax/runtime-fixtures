# Octoport engraving design — production acceptance — 2026-09-27 R2

Status: **PASS / PRODUCTION ACCEPTED**

## 1. Owner instruction

The owner instructed the site work to stop using the old static foundation as the visual source, restore the previously developed working design, and integrate that design with engraving variant 3.

This acceptance covers that bounded visual integration.

## 2. Deployed source

Design branch before integration:
`design/engraving-integration-2026-09-27-r1`

Accepted/deployed site source:
`2000908334d0e77c7b19602bfb84294f9b11dafe`

Base main before integration:
`61bb49f3553fd217a9a2c8d8ff8d9f92419f0184`

Integration:
- fast-forward;
- force push = false;
- commits ahead = 2;
- changed paths = 12.

Production release:
`/var/www/octoport-site/releases/2000908334d0e77c7b19602bfb84294f9b11dafe`

Previous production release:
`/var/www/octoport-site/releases/6a0149c958423082a62d5cb84ac757eed2e785a2`

Transition backup:
`/var/backups/octoport-site/20260927T083950Z`

## 3. Visual source restored

The visual source is the previously developed Octoport working-design direction:
- Rubik;
- engraving variant 3;
- light/dark theme;
- octopus as the central visual;
- six AI badges;
- separate Wildberries and Ozon badges;
- the accepted SEO/page structure retained.

The old product-safe foundation is no longer the HOME visual system.

## 4. Badge-separation defect closure

The original implementation error used image crops for badges, so hover could move octopus/tentacle/background pixels with a badge.

R1 still had black rectangular patches under the Wildberries/Ozon positions.

R2 removes that architecture.

Current underlay:
`apps/site/public/assets/engraving-3-underlay.webp`

Properties:
- 1024x1024;
- WebP with alpha;
- clean eight-tentacle engraving;
- no embedded AI/WB/Ozon badges;
- no rectangular badge holes;
- pointer-events disabled;
- never transformed by hover.

SHA-256:
`7461105df20de2760d111c2ee25a4d741969fc03131f6e4dc9026012acded27d`

Moving elements:
- 6 independent AI DOM badges;
- 2 independent marketplace DOM badges.

Hover/focus transforms only those eight badge elements.

## 5. Theme contract

Light:
- warm/light page;
- light engraving scene;
- light AI badges with dark marks;
- branded Wildberries/Ozon colors.

Dark:
- dark page;
- black engraving scene;
- dark AI badges with light marks;
- branded Wildberries/Ozon colors.

The same static octopus underlay is used in both themes.

Rubik loads through the allowed font stylesheet path. No executable public JavaScript was added.

## 6. SEO/product contract preserved

HOME remains:

- Title:
  `Подключите ваш ИИ к Ozon и Wildberries | Octoport`
- H1:
  `Подключите ваш ИИ к Ozon и Wildberries`
- self canonical:
  `https://octoport.ru/`
- accepted description;
- WebSite JSON-LD;
- crawlable link to `/seller-analytics`;
- utility links;
- current read-only/free-beta product boundaries.

Existing:
- `/seller-analytics`;
- `/privacy`;
- `/support`;
- `/install`;
- robots;
- sitemap;
- favicon;
- redirect/indexability contract

remain in place.

## 7. Source QA

Post-rebase exact-head source QA:

- git diff --check = PASS;
- deploy script syntax = PASS;
- verifier syntax = PASS;
- Site CI inline validator = PASS;
- site deployment regression = 13/13 PASS;
- deploy source assert = PASS.

Utility browser source checks:
- seller-analytics desktop + 320 = PASS;
- privacy desktop + 320 = PASS;
- support desktop + 320 = PASS;
- install desktop + 320 = PASS.

## 8. Exact-head GitHub CI

Design branch `2000908334d0e77c7b19602bfb84294f9b11dafe`:
- Site CI run `36306680695` = SUCCESS;
- Site Deploy CI run `36306680589` = SUCCESS.

Main exact head `2000908334d0e77c7b19602bfb84294f9b11dafe`:
- Site CI run `36306806543` = SUCCESS;
- Site Deploy CI run `36306806596` = SUCCESS;
- Documentation CI run `36306806529` = SUCCESS;
- Coordination and release safety run `36306806576` = SUCCESS;
- Extension I1-C1 client run `36306806589` = SUCCESS.

Unrelated server/extension workflows are not used as site acceptance substitutes.

## 9. Production byte parity

Live underlay SHA-256:
`7461105df20de2760d111c2ee25a4d741969fc03131f6e4dc9026012acded27d`

Live HOME SHA-256:
`f1ac70912968d143a00162b8e55362e1a61cd50c936574cd6159c597e344ec4b`

Source HOME SHA-256:
`f1ac70912968d143a00162b8e55362e1a61cd50c936574cd6159c597e344ec4b`

Live CSS SHA-256:
`d44601880d0a532294616c147b157426c363113d180512486f4a16bf18f47798`

Source CSS SHA-256:
`d44601880d0a532294616c147b157426c363113d180512486f4a16bf18f47798`

Therefore live HOME/CSS and the clean engraving asset match the accepted source bytes.

## 10. Production verifier

Repository production verifier:
**PASS**

It confirmed:
- current static release;
- nginx syntax;
- inherited security headers;
- TLS;
- redirects;
- application/API ingress safety;
- anonymous authentication guard;
- legacy docs service.

Application ingress SHA-256 remained:
`2675ab2704977645c03cfd758e92c97429ecfd112ef3af1bb2d89f40d4738bdc`

## 11. Live browser/interaction QA

Chrome:
- desktop light = PASS;
- desktop dark = PASS;
- 390 light = PASS;
- 390 dark = PASS;
- 320 light = PASS;
- 320 dark = PASS.

At 320 px:
`scrollWidth == clientWidth == 305`.

Badges:
- count = 8;
- hover = 8/8 PASS;
- underlay geometry unchanged on every hover;
- WB hover moves only WB badge;
- Ozon hover moves only Ozon badge;
- no rectangular hole or fixed duplicate appears after movement.

Opera desktop:
**PASS**

Yandex desktop:
**PASS**

Both vendor probes confirmed:
- accepted Title/H1;
- 8 badges;
- Rubik family;
- engraving underlay 1024x1024;
- no horizontal overflow.

## 12. Full-page visual QA

Production full-page captures were reviewed for:
- HOME hero;
- task cards;
- How to start;
- analytics block;
- control/data block;
- beta CTA;
- footer.

Desktop and mobile remain coherent after the shared visual-system replacement.

## 13. Live utility-page QA

Production:
- seller-analytics desktop + 320 = PASS;
- privacy desktop + 320 = PASS;
- support desktop + 320 = PASS;
- install desktop + 320 = PASS.

All preserve:
- H1;
- canonical;
- shared stylesheet;
- no document horizontal overflow.

## 14. Evidence

Local acceptance evidence:
`/root/octoport-control/logs/site-design-acceptance-20260927-r2/`

Key hashes:
- verifier.log:
  `2032a0d9be1a9d35b7c852c7d61e9f65ad5af28e3be381027af150b5c4eea67e`
- hover-mobile.json:
  `b7d4672cc4c7ef35c0bc6d840b8dba72098d4669413895c87486e1feee387b31`
- utility-live.json:
  `cdf97ab48c4e2d4926f945941d48e32ceda0de01859ceeb23d2e6c3dd8f26f89`
- desktop full-page:
  `02bac4a919c4912847ed7d88c9d4fdb6b6222411d1762081fcdd851170f01194`
- mobile full-page:
  `37f1d9f3afe9b4187b957ce87e195b23268d5f49b6b8f550ff91b6b9de858386`

## 15. Verdict

```text
WORKING_DESIGN_TRANSFERRED = true
ENGRAVING_VARIANT_3_INTEGRATED = true
CLEAN_UNDERLAY = true
BADGES_INDEPENDENT = 8/8
LIGHT_THEME = PASS
DARK_THEME = PASS
CHROME = PASS
OPERA = PASS
YANDEX = PASS
MOBILE_390 = PASS
MOBILE_320 = PASS
UTILITY_PAGES = PASS
SEO_CONTRACT_PRESERVED = true
APPLICATION_INGRESS_UNCHANGED = true
OPEN_CRITICAL_DESIGN_DEFECTS = 0

FINAL_VERDICT = PASS_PRODUCTION_ACCEPTED
```
