# M8 R3 oversized raw-ledger publication recovery — pre-step

Date: 2026-09-24
Status: PREPARED / ONE-ACTION OWNER RECOVERY
LIVE_HEAD: deaa430f2c4cde69c628930f01e116bba8896335

Trigger:
- all M8 R3 outputs except M8_RAW_OCCURRENCE_LEDGER.tsv are already published;
- raw ledger is exactly 76,810,357 bytes, above GitHub Web 25 MiB upload limit but below Git's 100 MB blob limit;
- owner supplied the original raw ledger to Main Chat.

Verified original identity:
- bytes: 76810357
- sha256: 2091432f5eb131b425349954f0518cc8122e98461d932d9b2d7de64e6828bcfc
- data rows: 25229
- source-layer counts: 1123 / 15542 / 8431 / 133
- raw_id -> semantic_id and raw_id -> semantic_id -> exact_safe_key order hashes match published XREF.

Deterministic gzip transport prepared by Main Chat:
- filename: M8_RAW_OCCURRENCE_LEDGER.tsv.gz
- gzip bytes: 4279362
- gzip sha256: 6f87fdadcc56d5aef493902f5bf17f44fbc37d113233c8531e4e9c0ea23d71c5
- gzip Git blob SHA-1: a8e5ded6e296f9fec94e08de0bdf61108a7e5419
- gzip mtime: 0

Recovery method:
1. Main Chat publishes a temporary path-filtered GitHub Actions workflow.
2. Owner uploads exactly M8_RAW_OCCURRENCE_LEDGER.tsv.gz to the existing M8 R3 staging directory using GitHub Web.
3. Workflow runs only for that gzip path on the SEO branch.
4. Workflow verifies gzip sha256.
5. Workflow gunzips to M8_RAW_OCCURRENCE_LEDGER.tsv.
6. Workflow verifies raw sha256 and byte size.
7. Workflow commits the raw TSV and deletes the gzip in the same commit.
8. Main Chat remote-readbacks the raw file identity and completes M8 QA.
9. Temporary workflow may then be removed after acceptance.

No Work rerun.
No semantic regeneration.
No provider/web acquisition.
No authority split into chunks.
