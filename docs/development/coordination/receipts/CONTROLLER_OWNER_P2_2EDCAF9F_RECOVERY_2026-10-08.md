# Controller owner P2 recovery, 2026-10-08

Task: C00-CONTROLLER-OWNER-P2-2EDCAF9F-RECOVERY-20261008. Sole source author: controller; administrative queue role A. Owner explicitly requested both fixes personally.

The review of main 2edcaf9f reported two reproducible defects, still present at initial main 78cfefc38d63b31789dd8125e2f4d06cc4d26be4.

- Actual composed tracker, worker and saPopupState regression: active_visible becomes inactive when Alice DOM conversation ID disappears, and remains inactive when it returns. The tracker now preserves the confirmed external address only with overlapping history in the same context. Unknown/conflicting observations suspend effects without replacing its proof. Navigation, account/provider changes and a different explicit ID retain their existing isolation fences.
- Actual runApiWatchReport regression with two loopback WB documents: accepted baseline, missing enabled operation, exact baseline restoration gives COMPLETED and no blocking crosswalk rows, but the family incident stays OPEN. Fresh complete-family absence now records a durable document-set fingerprint in the existing safe summary field. Resolution requires that same document set at accepted baselines and the matching enabled operation in this report. Legacy unproven null scope remains open; no schema or data migration and no live incident rewrite.

Validation before independent review: 40 composed conversation lifecycle cases PASS; 244 API-watch tests across 12 files PASS; API-watch TypeScript and changed TypeScript ESLint PASS. New tests were observed failing on unchanged source before the fixes. Real popup handler is exercised in the offline worker harness; this is not an installed browser acceptance claim. No production service, DB, browser or session was changed.

Evidence: /root/octoport-control/controllers/audits/OWNER-P2-REVIEW-2EDCAF9F-20261008. RED_RESULTS.json, POPUP_RED.log, API_FAMILY_RED.log, GREEN_RESULTS.json, RELATED_RESULTS.json and associated logs preserve commands and results. Existing unrelated active scope was checked and B acknowledged non-overlap. Source review, exact CI and publication are separate subsequent receipts; this document does not claim them.

Before progress reports, the controller reread the required reporting section: access statements match actual calls, written results were read back, and unfinished disk release deletion remains explicitly separate.

Independent R1 review rejected the first unpublished candidate: its family marker exceeded the existing PostgreSQL varchar(80) constraint. This was reproduced against an actual disposable PostgreSQL TEMP table (22001), and in a committed SQL-binding regression reading the real migration limit. The marker is now 78 characters. Actual PostgreSQL storage and recreated-store readback passed OPEN to RESOLVED with exactly one RESOLVED notification. The R1 FAIL receipt and red/green DB logs remain preserved. No live database or schema was changed.
