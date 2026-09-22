# M4A R3 QA

WORK_ID: `OCTOPORT_SEO_M4A_HARDENED_2026-09-18_R3`

STATUS: **PASS CANDIDATE — MAIN CHAT ACCEPTANCE REQUIRED**

## Hard checks

- `LIVE_BRANCH_FETCHED = true`
- `RELEASE_IDENTITY_VERIFIED = true`
- `AUTHORITY_QUERY_COUNT = 15`
- `PER_QUERY_ACCEPTED_ROWS = 20 each`
- `TOTAL_OCCURRENCES = 300`
- `RANKS_1_20_COMPLETE_EACH_QUERY = true`
- `ORIGINAL_R04_ACCEPTED_ROWS = 0`
- `R04R1_ACCEPTED_ROWS = 20`
- `TOP3_TOP10_11_20_LAYERING = PASS`
- `ALL_OCCURRENCES_CLASSIFIED = 300`
- `SILENT_ROW_LOSS = 0`
- `RAW_URL_LINEAGE_PRESERVED = true`
- `PAIRWISE_ROWS = 105`
- `PAIRWISE_UNORDERED_DUPLICATES = 0`
- `EXACT_URL_AND_DOMAIN_OVERLAP_SEPARATE = true`
- `COLLISION_UNCERTAINTY_PRESERVED = true`
- `DOMAIN_RECURRENCE_COMPLETE = true`
- `RECURRENCE_GRANULARITY_EXPLICIT = true`
- `CURATED_REGISTRY_TRACEABLE = true`
- `NO_PRESEEDED_BRAND_AUTHORITY = true`
- `NATIVE_BASELINE_SEPARATED = true`
- `M4B_PAGE_MANIFEST_EXISTS = true`
- `FINAL_CLUSTER_DECISIONS = 0`
- `FINAL_PAGE_OWNERSHIP_DECISIONS = 0`
- `NEW_PROVIDER_CALLS = 0`
- `EXTERNAL_VENDOR_BROWSING = 0`
- `R06_DERIVED_RECOVERY_AUTHORITY = VERIFIED`
- `R06_RECOVERED_SOURCE_BYTES = 73385`
- `R06_RECOVERED_SOURCE_SHA256 = 78759292ba7f23ad741329cc631b9ec90b26abcff4e0b97fc81ff5289d0708f6`
- `R06_HISTORICAL_MANIFEST_USED_AS_CURRENT = false`
- `OPEN_CRITICAL_DEFECTS = 0`

## Additional joins and schema checks
- Domain recurrence rows: `127`; every occurrence ID appears in exactly one domain row.
- Collision ledger rows: `92`; all classified collision/uncertainty occurrences are retained.
- Registry rows: `60`; every registry row traces to occurrence IDs.
- Page candidates: `143`; every row joins to an existing registry ID and accepted occurrence URL.
- TSV mandatory headers: PASS.
- Raw URLs and normalized URLs are separate fields: PASS.
- R06 standard gzip and all R3 fixed identities: PASS.

- S03 single-object resolution with one surplus trailing brace: deterministic, documented in source manifest, no row ambiguity.
## Limitations

Classification uses only captured URL/title/snippet evidence and accepted analyses; no page was browsed. Registrable-domain extraction is conservative and explicitly preserves special app-store hosts. Curated registry selection is an M4A Search registry, not proof of commercial rivalry.

M4A_R3_WORK_VERDICT = PASS_CANDIDATE
