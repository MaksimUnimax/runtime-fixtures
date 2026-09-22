# M4C synthesis R1 Work-return staging

WORK_ID: OCTOPORT_SEO_M4C_SYNTHESIS_2026-09-22_R1

Status: PARTIAL OWNER UPLOAD + GITHUB WEB TRANSPORT CORRECTION ACTIVE

Transport authority:
../../M4C_GITHUB_WEB_TRANSPORT_CORRECTION_2026-09-22_R1.md

Already uploaded unchanged in owner commit cc4a30a742b2544eb1e52e40b14d97a2c29fb79d:
- M4C_COMPETITOR_CANDIDATE_REGISTER.tsv
- M4C_COVERAGE_LEDGER.tsv
- M4C_HARDENED_COMPETITOR_REGISTRY.tsv
- M4C_M5_AI_HYPOTHESIS_INPUTS.tsv
- M4C_M6_DEMAND_GAP_CANDIDATES.tsv
- M4C_URL_LEDGER.tsv

Still required as unchanged small logical files:
- M4C_QA.md
- M4C_RETURN_MANIFEST.json
- M4C_SOURCE_MANIFEST.md

Oversized logical files are persisted as byte-exact ordered parts:
- M4C_PAGE_EVIDENCE.tsv.part001
- M4C_PAGE_EVIDENCE.tsv.part002
- M4C_TASK_CAPABILITY_CLAIM_CONTENT_MATRIX.tsv.part001 ... part009

Transport metadata already persisted here:
- M4C_GITHUB_WEB_TRANSPORT_MANIFEST.json
- REASSEMBLE_M4C_OVERSIZED.py

Do not upload the original oversized TSVs through GitHub Web.
Do not recompute Work.
After all remaining 14 payload files are present, Main Chat reconstructs the two logical TSV byte streams, verifies original hashes/bytes, then performs independent M4C return QA.
