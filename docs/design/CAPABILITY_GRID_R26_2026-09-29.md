# Capability grid R26

Date: 2026-09-29

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

Owner requested the six capability disclosure blocks on HOME to remain stacked one-by-one on phone, but use two blocks per row on tablet and desktop.

Implementation:
- default/tablet/desktop: `.capability-groups` uses two equal columns;
- phone breakpoint: at `max-width:620px` it returns to one column;
- when a capability is opened on tablet/desktop, the opened disclosure spans both columns so the inner detail content keeps comfortable reading width;
- on phone, an opened disclosure remains a normal single-column block;
- all existing text, plus/minus controls and disclosure behavior remain unchanged.

Source acceptance:
- desktop 1440: 2 columns × 3 rows, six cards 614px wide;
- tablet 768: 2 columns × 3 rows;
- phone 390: 1 column × 6 rows;
- opened desktop disclosure spans full grid width and keeps its internal two-column details; phone details stay one column.

## Production acceptance

Production source commit: `7aaa09b7018c6928f4a3969bbb2d9cde8b8ceb9b`.
Live release: `/var/www/octoport-site/releases/7aaa09b7018c6928f4a3969bbb2d9cde8b8ceb9b`.
Rollback backup: `/var/backups/octoport-site/20260929T120112Z`.

Live layout measurements:
- 1440px: two columns, cards paired 2 per row; each closed card 614px wide;
- 768px tablet: two columns, cards paired 2 per row; each closed card 354px wide;
- phone 390px: source/browser screenshot verifies one column, six cards stacked vertically;
- opened disclosure spans both columns on tablet/desktop and remains single-column on phone.

Regression: 45/45 site source tests PASS; Chrome approved-copy run PASS (15 states / 48 disclosure interactions).
