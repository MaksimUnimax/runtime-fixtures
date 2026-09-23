# A04 — client Q1 / sync / no-replay gap reconciliation

Status: **IMPLEMENTATION_COMPLETE / OWNER_LIVE_AND_ENVIRONMENT_GATES_DEFERRED / READY_FOR_C REVIEW**  
Task: `A04`  
Role: `A`  
Exact reviewed stream HEAD before this receipt: `38b3742b989a7ca9ef4dc75246919f50cb76f258`.

This is an evidence/reconciliation closure. It intentionally makes **no production-code change** and does not repeat already accepted browser/provider ambiguity tests.

## Three-level conclusion

1. **Component:** current store catalog, C3E sync journal, C3F reconciliation, P1/P2/P3 recovery and A24/transfer paths retain their accepted fences. No current A04 source defect was established.
2. **Subsystem:** the initially suspected store-metadata `/v1/sync` gap was already closed by D3S2-1 R3/R4. R3 fixed the order-sensitive `SYNC_JOURNAL_WRITE_READBACK_FAILED` durability comparison with recursive canonical object-key ordering. R4 then exercised the actual unpacked source and extracted runtimes through production `/v1/sync` with dedicated HTTP receipts.
3. **Product invariant:** ordinary Ozon/WB command and AI delivery paths remain autonomous; metadata sync cannot replay provider UNKNOWN, resend AI delivery UNKNOWN, resurrect tombstones, cross account/store/dialogue boundaries, or become a second Work authority.

## Previously accepted installed sync evidence not reopened

Authoritative receipt: `docs/development/client-i1/D3S2_1_STORE_METADATA_STATE.md`.

R4 records actual-unpacked Chromium source/generated and extracted/package runs through the real C3E journal and production `SellerAgentsControlClient.synchronizeMetadata` client. The combined R4 batch observed 10 `/v1/sync` requests per runtime (20 total) and PASS for:

- stale `STORE_UPSERT` after tombstone with no resurrection;
- second-installation convergence with unrelated store preserved;
- opaque `credentialRevision` convergence fencing old Work;
- duplicate `requestId` retry with one server revision change;
- delayed M1 ACK after newer M2 without compacting/overwriting M2.

The same receipt records D3S2 59/59, C3F 28/28, C3G, C3H, P1, P2, P3, Extension Core 111 gates, Extension I1 138 gates, PostgreSQL 1533/1533, API 225/225 and E2E 88/88 at that accepted candidate. Those historical counts are not relabeled as tests of today's SHA; they establish that the installed transport acceptance gap was already closed.

## Current-SHA drift check

Current `apps/extension/src/application/sync-journal.js` still uses recursive canonical JSON for write/readback equality; the old raw `JSON.stringify` ordering defect is not present.

Lightweight current-source checks under Node `v24.20.0`:

- `client-d3s2-store-metadata-state.mjs`: **59/59 PASS**;
- `client-d3s2-c3e-store-journal.mjs`: rename **PASS**, offline retention **PASS**, tombstone **PASS**, recovery **PASS**.

Evidence root:
`/root/octoport-control/logs/A/A04_CURRENT_SOURCE_RECHECK_R1/`

Evidence hashes:

- `store-state.log`: `3b39905316bae52974bd156f9c95f9d93c31f5308816f2e128659b74ccabf053`;
- `c3e.log`: `96a91de6e4d7c6748568e766f8b09396ae914e8b5ed9600328c3aa3d1782da3d`.

## Independent review and correction

Read-only Luna task `a04-client-q1-gap-review-r1` found no confirmed current source defect but initially recommended rerunning the installed store-sync transport because it stopped at the older R2 defer. Parent review found the later R3/R4 sections in the same authoritative receipt, which already close that gap. The review recommendation was therefore corrected rather than causing duplicate work.

## A04 requirements that are already bounded automated

Existing accepted/current evidence covers:

- Ozon/WB multi-store and parallel-dialogue isolation;
- explicit Start/Resume/Finish/rebind fencing;
- store metadata/tombstone convergence and late ACK ordering;
- provider UNKNOWN no automatic replay;
- AI delivery UNKNOWN no automatic resend;
- known-result recovery and bounded expiry;
- 429/Retry-After re-gating without hidden retry;
- optional sync failure/backlog/conflict isolation;
- zero mandatory control-plane calls for ordinary Ozon/WB command and AI delivery paths;
- account/store/dialogue/context fences in synthetic/installed scope;
- A22/A23 transfer and A24 export/import bounded automated candidates, with A02 MV3 recipient recovery separately submitted on 2026-09-23.

## Remaining A04 gates — not code defects

These remain exactly as Q1-C owner/live/environment work and are **not** converted to PASS here:

- real Ozon Seller/Performance rights, expiry and confirmed provider account identity;
- real Wildberries credential/provider execution;
- owner-authenticated logout/re-login/account switch and retain/delete UX;
- real ChatGPT/Alice composer/upload/session variants;
- live report/file sizes and sleep/restart combinations;
- second legitimate browser/device and live multi-browser observation;
- branded Chrome/Yandex/Firefox/Safari environment-specific release evidence already tracked under A03/Q1-C;
- owner/live transfer/export/import UX and Stream-2 Health provenance.

Q1-C matrix remains the authority for those cards. Unsafe provider UNKNOWN/forced-429 cases explicitly remain `ALREADY_ACCEPTED_AUTOMATED` and must not be manufactured live merely to repeat evidence.

## Disposition

`A04_IMPLEMENTATION_COMPLETE_OWNER_LIVE_DEFERRED`

No new A04 product architecture is required from the evidence reviewed. Any failure in the later owner/live cards is classified on its own exact browser/provider/session/package before reopening implementation.
