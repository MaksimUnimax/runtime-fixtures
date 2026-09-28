# B18 decisive ordering follow-up — 2026-09-28

Status: **SOURCE / DISPOSABLE POSTGRESQL VALIDATED CORRECTIVE CANDIDATE — NOT LIVE**

Base B18 candidate: `a62aff630c464d7307dd79ce5d198bffa6f863f0`.

Controller findings addressed:
- `B-B18-UNKNOWN-ORDERING-20260928-0831`;
- existing cross-boundary ordering review remains covered by the same incident state-machine.

## Problem

The B18 legacy reconciler must not treat a newer `UNKNOWN` observation as health proof. The previous supersession helper used the latest scope-state row regardless of classification, so a projected UNKNOWN could hide an older decisive BROKEN/HEALTHY transition during historical catch-up.

## Correction

No schema/migration change is required.

- The max-3 compact recent-state ring now preserves a decisive state across repeated UNKNOWN churn: when full and a new UNKNOWN fingerprint arrives, an older UNKNOWN is replaced before evicting the sole decisive state.
- NO_SESSION incident supersession reads the latest non-UNKNOWN compact state for the same incident identity (provider/surface/target/strategy/browser family/profile) and uses its durable replay receipt. Raw observation JSON is not the ordering authority.
- An older legacy BROKEN run is ignored behind a newer decisive HEALTHY even when the newest projected observation is UNKNOWN.
- A BROKEN run remains authoritative behind one or many newer UNKNOWN observations.
- Existing normal incident processing and legacy catch-up continue through the same incident repository/state machine.
- Recovery/maintenance-exit notifications are emitted only when the incident has prior presented OPENED/ESCALATED/MAINTENANCE_ENTERED history, preventing a recovery-only historical message for a silent catch-up episode.
- Routine replay receipts cannot retire while the same schedule still has marker-null incident-processing history, preserving the decisive compact/receipt authority until legacy catch-up completes.

## Disposable PostgreSQL evidence

Upgrade/order-equivalence:
- `health-retention-upgrade.integration.test.ts`: **6/6 PASS**.
- Covers:
  - real 0051 -> 0052 upgrade/backfill;
  - ordered crash/restart reconciliation;
  - older BROKEN behind newer already-processed HEALTHY;
  - existing OPEN from BROKEN -> HEALTHY marker-missing -> newer UNKNOWN: resolves at HEALTHY;
  - BROKEN behind repeated UNKNOWN fingerprints: BROKEN remains OPEN;
  - silent historical incident resolution creates no recovery-only notification.
- supervisor `octoport-test-b-177dc608c038441fad70b68a42f038eb.service`, exit 0, peak 533 MiB, cleanup verified.

Routine retention:
- `health-no-session-persistence.integration.test.ts`: **7/7 PASS**.
- Confirms max-3/coalescing, baseline/incident/notification pins, raw-payload pruning, late callback replay receipt, metadata retirement/watermark and no-replay.
- supervisor `octoport-test-b-c1ec63fd5c5e4ae3b8c8d44069b880c8.service`, exit 0, peak 535 MiB, cleanup verified.

Incident repository regressions:
- `health-incidents.integration.test.ts`: **7/7 PASS**, supervisor `octoport-test-b-ba476a473b1943a593d7355410767edd.service`.
- `health-incident-migration.integration.test.ts`: **2/2 PASS**, supervisor `octoport-test-b-5e1b715ed86f490cb9c243f2b5222187.service`.
- Both exit 0 / cleanup verified.

Current migration-fact CI blocker was already closed in base `a62aff63` and independently revalidated here:
- p2 auth **14/14 PASS**;
- p5-7 final acceptance **80/80 PASS**;
- p6-1 admin security **77/77 PASS**;
- adapter registry **7/7 PASS**;
- canonical lineage **7/7 PASS**.

Quality:
- DB unit **31/31 PASS**, DB typecheck PASS, targeted ESLint/Prettier and `git diff --check` PASS;
- supervisor `octoport-test-b-5d409f478df34ec5bc7cc132859028b9.service`, exit 0, peak 739 MiB, cleanup verified.

## Boundary

No live database mutation, pilot GC, provider/browser call, Telegram delivery, H3 execution, deployment or owner action was performed. C still owns exact integration/CI and any later authorized isolated-pilot dry run/apply.
