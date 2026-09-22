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


## Transport exception — single ZIP accepted

GitHub Web batch publication of the 11 split part files failed even though each individual part is below 25 MiB.

To minimize owner interaction and avoid server-side relay, the accepted durable transport is now ONE ZIP containing exactly the 11 byte-exact part files:

`M4C_ONLY_11_PARTS.zip`

Expected ZIP identity:

```text
BYTES = 10082076
SHA256 = 57ada78d090695163e33c14faed1fce5cd9f42c29fe5f4527d9b3e30aa05a04e
FILES = 11
```

The ZIP does not replace the logical M4C artifacts analytically. It is only their durable GitHub transport container.

Existing authorities in this folder:
- `M4C_GITHUB_WEB_TRANSPORT_MANIFEST.json`
- `REASSEMBLE_M4C_OVERSIZED.py`

Main Chat acceptance procedure after owner uploads the ZIP:

1. remote-readback the ZIP from GitHub;
2. verify ZIP bytes and SHA-256;
3. unpack locally;
4. verify all 11 part file names / byte sizes / SHA-256 values against the transport manifest;
5. reconstruct the two oversized logical TSV files in lexical part order;
6. verify:
   - `M4C_PAGE_EVIDENCE.tsv` SHA-256 = `e0433463f29daf4d2bec1dccd3fec541e9263161672c752898be18c18e7fa175`;
   - `M4C_TASK_CAPABILITY_CLAIM_CONTENT_MATRIX.tsv` SHA-256 = `e45d2e6640d7b366b354ca66e19affcce04c8b2b18629905cfd020f9a2d6bebe`;
7. only then perform final M4C return QA / acceptance.

Do not require the owner to upload the 11 part files individually while this verified single-ZIP route is available.
