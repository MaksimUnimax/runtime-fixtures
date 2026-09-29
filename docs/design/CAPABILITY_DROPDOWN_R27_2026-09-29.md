# Capability dropdown R27

Date: 2026-09-29

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

Owner correction to R26:
- do not center capability labels;
- reduce closed control height by about 20%;
- reduce capability label/detail text size;
- opening a capability must expand downward inside its existing column instead of widening across both columns;
- phone remains one column; tablet/desktop remain two columns.

Implementation:
- closed summary height: 58px target (previously ~72px);
- summary labels: left-aligned, 17px desktop/tablet, 16px phone;
- open details remain inside the same card/column (`grid-column:auto`);
- opened content becomes one vertical column under the summary;
- detail headings/text reduced to 16px/15px desktop/tablet and 15px/14px phone;
- plus/minus control stays on the right.

Measured local behavior:
- 1440 closed card: 614px wide, 58px summary; open card remains 614px wide and grows downward;
- 768 closed card: 354px wide, 58px summary; open card remains 354px wide and grows downward;
- 390 phone: one-column card remains 358px wide and grows downward.
