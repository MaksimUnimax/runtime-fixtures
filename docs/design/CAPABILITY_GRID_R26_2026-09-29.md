# Capability grid R26

Date: 2026-09-29

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

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
