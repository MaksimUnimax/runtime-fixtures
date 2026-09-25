# C02 A04 business-coverage superseding intake — 2026-09-25

Status: CANDIDATE / NOT MAIN / NOT DEPLOYED

Accepted prior C base:
`cec11537f0baa90e4d104dfcf5ba308a70102c49`.

Superseding exact A submission:
`a1643665c10f8a054b6a922867f17469aef9445b`.

C merge:
`5797bdf9e1e7061556d9fa5d72222765268bacd7`.

Relative to the previously accepted A04 candidate, this submission changes only:
- `docs/development/coordination/receipts/A/A04_BUSINESS_COVERAGE_RECONCILIATION_2026-09-25.md`;
- `tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json`.

No extension/runtime/server/shared-readiness implementation changed.

## Updated bounded classification

Current operation/schema mapping:
- WB DIRECT: 2;
- WB COMPOSITE: 33;
- WB BOUNDARY: 5;
- EXTERNAL_CONTEXT: 3;
- CONTRIBUTION_ONLY: 1;
- LOCAL_FILE_HISTORY: 1.

CAP-12 is operation/schema-level COMPOSITE based on the captured current WB FBS/DBS/DBW status/cancellation documentation and pinned current aliases. This does not prove live-account values or full field-level provider acceptance.

STD-11 remains BOUNDARY: stock snapshots/history do not prove a causal inventory movement/write-off event source.

The later independent refetch returned HTTP 498, so no stronger freshness claim is added.

## C verification

Pinned Node 24.20.0.

Focused resource job:
- unit `octoport-test-c-a2d94bc4abef4bc395af5693a5607616.service`;
- exit 0;
- peak 19 MiB;
- cleanup verified.

Results:
- business coverage PASS: 45/45 rows, Ozon 101 refs, WB 137 refs, 25 numeric cases;
- core-contracts: 9/9 PASS;
- live provider calls: 0;
- no installed/live acceptance claimed.

Remaining field-schema/live-value/AI-surface/store/deployment gates remain separate.
