# C02 A04 business-coverage intake — 2026-09-25

Status: CANDIDATE / NOT MAIN / NOT DEPLOYED

Base C head:
`7dc3bda1d46bde83e1571c76d9c0f87e61ece000`.

Exact A submission:
`cc9c2bcef3e7166b4b87bcd26cea4b5e52e5c17a`.

C merge:
`147c17b46bc7e1d6b02c18ceeae8a584a692d6db`.

The candidate already contains prior accepted A03 browser-parity history. Relative to current C it adds exactly five A04 test/evidence files and no runtime/product implementation.

## C validation

Pinned Node: 24.20.0.

Focused merged-tree job:
- resource unit: `octoport-test-c-ae1dee7aa72148968623cd620692b4ed.service`;
- exit code: 0;
- peak: 96 MiB;
- cleanup verified.

Results:
- business scenario coverage: PASS, 45/45 rows;
- Ozon operation refs: 101;
- WB operation refs: 137 across 12 host families;
- deterministic numeric fixtures: 25;
- core-contracts: 9/9 PASS;
- WB adapter: 22/22 PASS;
- live provider calls: 0;
- installed acceptance: false.

## Boundaries

This accepts operation-level mapping and deterministic fail-closed interpretation evidence only.

Still open:
- fresh/full WB field-schema/unit crosswalk where not already bounded by captured current docs;
- live Ozon/WB values and owner gold-set agreement;
- AI-surface scenario acceptance;
- owner marketplace credentials/provider calls;
- store/reviewer/deployment acceptance.

The concurrent B STORE1 activation candidates still pin historical `891b89f...` / Opera ZIP `6914b019...`. They are not accepted by this intake and must be rebound to the repaired final package identity before C can integrate them.

No live DB/service/catalog/store mutation was performed.
