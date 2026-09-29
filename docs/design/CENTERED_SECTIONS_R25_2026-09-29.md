# Centered sections R25

Date: 2026-09-29

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

Owner requested visual centering of the major explanatory sections and the seller-analytics page.

HOME changes:
- center `Что даёт Октопорт продавцу` heading and copy;
- center `Работаете в привычном вам браузере` heading and copy;
- stack the strong-model section into one centered column, with its three example cards centered below;
- center the `Контроль и данные` heading/copy and both data notes.

Seller analytics changes:
- center hero eyebrow, H1, lead and CTA row;
- center section headings and introductory copy;
- widen and center the section/card column to 1040px;
- center each case heading and example question while keeping the data/result definition list left-aligned for readability;
- center the final access CTA row.

Both HOME and `/seller-analytics` receive a new CSS cache key `centered-sections-r25-20260929`.

Production source commit: `7aba087415ab3bbbe25b9b4a372e6f43df87ddc0`.
Live release: `/var/www/octoport-site/releases/7aba087415ab3bbbe25b9b4a372e6f43df87ddc0`.
Rollback backup: `/var/backups/octoport-site/20260929T115038Z`.

Live acceptance:
- Chrome, Opera and Yandex Browser: 15 states / 48 disclosure interactions PASS each;
- 1440 and 390 measurements confirm exact horizontal centering for features, browser workflow, strong-model copy, control/data copy and seller-analytics sections;
- seller-analytics cards are centered as blocks; card titles/questions are centered, while the data/result definition rows stay left-aligned for readability.
