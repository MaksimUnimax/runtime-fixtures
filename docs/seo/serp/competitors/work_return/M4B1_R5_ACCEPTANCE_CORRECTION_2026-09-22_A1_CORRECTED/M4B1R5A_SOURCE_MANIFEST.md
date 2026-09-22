# M4B1 R5 Acceptance Correction A1 Source Manifest

WORK_ID: OCTOPORT_SEO_M4B1_R5_ACCEPTANCE_CORRECTION_2026-09-22_A1

STATUS: PASS

## Repository authority

- Repository: MaksimUnimax/runtime-fixtures
- Branch: seo/wordstat-batch-01-2026-09-16
- Start live remote HEAD: 3ae5775e83f7c15d340825fd7ef4cd6cde64a74b
- End observed remote HEAD: 3ae5775e83f7c15d340825fd7ef4cd6cde64a74b
- Authority drift detected: false
- Material M4B1 authority drift: false
- GitHub writes: 0

## Frozen R5 evidence used

- M4B1R5_URL_OVERLAY.tsv: 5,455 rows; SHA-256 `4a7e71693e7f434dcdefad60a8733372d9c427f1fba76305cf09b706044f4dfd`
- M4B1R5_PAGE_EVIDENCE_OVERLAY.tsv: 5,455 rows; SHA-256 `cf39aae1f9ff20797b418bf91081bf4e15b000c3b9a1783154d2ddaa4da887b4`
- M4B1R5_FRONTIER_RECONCILIATION.tsv: 45 rows; current-state authority before accounting normalization

The accepted 5,455 URL rows and 5,455 page-evidence rows were read only for identity reconciliation. They were not regenerated, rewritten or refetched.

## Accepted phase authority used

- R1: accepted `r1_current_url_count` phase counts carried by M4B1R4_FRONTIER_RECONCILIATION.tsv, with M4B1_URL_LEDGER.tsv used for REG024/REG051 count and identity reconciliation.
- R2: accepted `r2_added_url_count` phase counts carried by M4B1R4_FRONTIER_RECONCILIATION.tsv, with M4B1R2_URL_LEDGER_OVERLAY.tsv used for REG024/REG051 count and identity reconciliation.
- R3: accepted `r3_discovered_url_count` phase counts carried by M4B1R4_FRONTIER_RECONCILIATION.tsv.
- R4: M4B1R4_URL_OVERLAY.tsv for exact R4 additions and M4B1R4_FRONTIER_RECONCILIATION.tsv for the accepted pre-R5 current state.
- R5: M4B1R5_URL_OVERLAY.tsv for exact R5 additions and M4B1R5_FRONTIER_RECONCILIATION.tsv for the accepted current totals.

## Uniseller historical occurrence snapshot

- Source collection: https://uniseller.io/blog/
- Snapshot ID: UNISELLER_BLOG_R5_20260921T132714781Z
- Snapshot timestamp: 2026-09-21T13:27:14.781Z
- Reconstruction method: complete retained R5 public-collection DOM occurrence ledger; no live recrawl and no page refetch.
- Retained source: live_uniseller_occurrences.tsv
- Retained source SHA-256: `cee097a88e2a8443712d5b917b853e1bb353af60ab1785ddab6cb15cf211f834`
- Retained physical occurrence rows: 5475
- Deterministic chunk size: 250 rows
- Persisted extraction chunks: 22

The retained R5 occurrence order was preserved exactly. Original zero-based collection indices 0..5474 map to correction occurrence indices 1..5475.

## Persisted deterministic chunks

| Chunk | First index | Last index | Rows | Status | SHA-256 |
| --- | ---: | ---: | ---: | --- | --- |
| R5A_CHUNK_001 | 1 | 250 | 250 | RECONSTRUCTED_SUCCESS | `1ab2554a9fd6e76364100d7df081e0cf9cd27879e90b54414a9539fc4ec0be6d` |
| R5A_CHUNK_002 | 251 | 500 | 250 | RECONSTRUCTED_SUCCESS | `f749c9afef12ad0c118fc46a264efb85e072012fe9fc5b62541936aaa198457e` |
| R5A_CHUNK_003 | 501 | 750 | 250 | RECONSTRUCTED_SUCCESS | `faf09488afd10ca533c47e84c01cb0eabcffa0c37473d9514ff82db0ac678deb` |
| R5A_CHUNK_004 | 751 | 1000 | 250 | RECONSTRUCTED_SUCCESS | `1927c150318b831c008807c82c3a0bf774086ae945d15afa898a3db8e2e34353` |
| R5A_CHUNK_005 | 1001 | 1250 | 250 | RECONSTRUCTED_SUCCESS | `d877940c6409afa000a492fb26d07fc277ffdc153537bfbc4cabad343ae50e70` |
| R5A_CHUNK_006 | 1251 | 1500 | 250 | RECONSTRUCTED_SUCCESS | `a7e85d93754c71d951ea07305dd26d14f992591b0dabf7e242c65be9d7591ea6` |
| R5A_CHUNK_007 | 1501 | 1750 | 250 | RECONSTRUCTED_SUCCESS | `b87595c1fbb6baebd348a12700da466ec463ec1dcdefa092daf3f1b6399c0be1` |
| R5A_CHUNK_008 | 1751 | 2000 | 250 | RECONSTRUCTED_SUCCESS | `b14c5b746db462fabd5169ed62a7601262c35cf6d4f931b945a2c5955eda62d8` |
| R5A_CHUNK_009 | 2001 | 2250 | 250 | RECONSTRUCTED_SUCCESS | `582b8b9afb29c825a3b76e703f98c6f70a9babb668d1dc75001f05ee36d1630d` |
| R5A_CHUNK_010 | 2251 | 2500 | 250 | RECONSTRUCTED_SUCCESS | `d09dc42fb833e566ecb5f9214dea6640924fabd4e8c113f4dacc85e95b61097c` |
| R5A_CHUNK_011 | 2501 | 2750 | 250 | RECONSTRUCTED_SUCCESS | `083896c3552a6097833dc39b950f9f289fac37f806e0323fe792a27e2ae80d34` |
| R5A_CHUNK_012 | 2751 | 3000 | 250 | RECONSTRUCTED_SUCCESS | `16aaef2c09258d37fb468bfa62636b4663508b73cf6428a00a8f56c08f13e0ca` |
| R5A_CHUNK_013 | 3001 | 3250 | 250 | RECONSTRUCTED_SUCCESS | `58e4333916571861edf02ef6cc5b7fd98d597c450e6337e2cbf2217cddefa4a4` |
| R5A_CHUNK_014 | 3251 | 3500 | 250 | RECONSTRUCTED_SUCCESS | `5644bc4eeb28deebc6e723dd21756fb9e9dcc343832633f36503aaa5e829766e` |
| R5A_CHUNK_015 | 3501 | 3750 | 250 | RECONSTRUCTED_SUCCESS | `6a47e926e1b95dc69a7a78cb85248efbb241be336268d762f6344b92a15e5656` |
| R5A_CHUNK_016 | 3751 | 4000 | 250 | RECONSTRUCTED_SUCCESS | `79595ffd4d083d1f7bfc413ef28fd2cb01c2cd135f1e29c2122100d906c5a83c` |
| R5A_CHUNK_017 | 4001 | 4250 | 250 | RECONSTRUCTED_SUCCESS | `e5a8cc8dd92567182420fb693fe71a8f4ad574cf948de7b2fce29fa1129f3be8` |
| R5A_CHUNK_018 | 4251 | 4500 | 250 | RECONSTRUCTED_SUCCESS | `a8aaeb75b8f21ab9c8cafe50f6fabf67e2243b6cf6979dc077631924c37b9033` |
| R5A_CHUNK_019 | 4501 | 4750 | 250 | RECONSTRUCTED_SUCCESS | `403307fe6baa55c72a8546ea35d854c3f713aa95ee43600ff0e4de627313cb5e` |
| R5A_CHUNK_020 | 4751 | 5000 | 250 | RECONSTRUCTED_SUCCESS | `5f5e3a99b1314af58dfabc15556868946487e797ae46b31e26c56db5bdc4a1d4` |
| R5A_CHUNK_021 | 5001 | 5250 | 250 | RECONSTRUCTED_SUCCESS | `dcfb31298d447caa8a1689852ad06dd92d542c28302c9b9c4c836f6f32285a53` |
| R5A_CHUNK_022 | 5251 | 5475 | 225 | RECONSTRUCTED_SUCCESS | `3f72297c2c9b2728f05d53b8b78876c5d7900778453b3b733192a09f28e929cf` |

## Lossless equations

- Chunk rows: 5475 = occurrence-ledger rows 5475
- 5475 occurrences - 1 duplicate occurrence = 5474 unique identities
- 19 already accepted + 5455 R5 new terminal = 5474 reconciled unique identities
- Silent URL loss: 0
