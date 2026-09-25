# B06 unclosed SPEC boundaries reconciliation — 2026-09-25

Status: **SOURCE / CURRENT-SHA TARGETED EVIDENCE COMPLETE FOR AUDITED B06 SERVER BOUNDARIES. LIVE, DEPLOYMENT, STORE AND COMMERCIAL ACCEPTANCE NOT CLAIMED.**

Task: `B06_UNCLOSED_SPEC_BOUNDARIES`.

This pass reconciles the current server/admin/free-beta remainder against `docs/product/SPEC.md`, `docs/product/readiness/MINIMUM_SPEC.md`, `docs/product/BETA_ADMISSION.md`, `docs/product/ADMIN_AND_WEB.md` and `docs/architecture/CONTRACTS.md`.

It does not treat historical green counts as current proof. The selected auth/beta/retention seams were rerun on the current B tree. Only one source evidence gap was found: v1 and v2 bootstrap had been tested separately, not together after a newer v2 catalog exists.

## Requirement → evidence ledger

| Boundary | Normative requirement | Current evidence | Result |
|---|---|---|---|
| Older installed client / v1 bootstrap | Preserve `control_plane_v1`; v2 is separate and latest config selection stays contract-scoped | New P3.4 PostgreSQL regression publishes v1 and newer v2 authorities simultaneously. v1 still receives signed `bootstrap_snapshot_v1/control_plane_v1` with the v1 configVersion; v2 receives its v2 configVersion | **CLOSED_SOURCE** |
| Current v2 bootstrap | Current client receives signed v2/account UUID authority | Same current P3.4 suite keeps privacy-neutral v2 and local-client-authority coverage green | **CLOSED_SOURCE** |
| Existing account with beta CLOSED/full | CLOSED limits new registration, not existing login | Current `p2-auth.integration.test.ts` **14/14**, including existing login while CLOSED/full | **CLOSED_SOURCE** |
| Beta quota/admin mutation | Atomic quota, revision/requestId, replay, audit, transaction-time permission | Current `s1-1-beta-admission.integration.test.ts` **12/12** | **CLOSED_SOURCE** |
| Refresh rotation / replay expiry | Atomic refresh rotation; replay window expiry/reuse fails closed | Current P2.4 PostgreSQL **12/12** | **CLOSED_SOURCE** |
| Durable account/session/device authority | Mismatch, suspension/revoke and durable authority are enforced server-side | Current P2.4 covers mismatches/forbidden state and refuses rotation after durable device revoke | **CLOSED_SOURCE** |
| Device revoke | Known revoke stops live credentials and remains audit-idempotent | Current P2.5 PostgreSQL **8/8**, including immediate credential revoke and capacity release | **CLOSED_SOURCE** |
| Feedback/support retention | Bounded retention with strict cutoff and failure-safe worker lifecycle | Current feedback/support PostgreSQL **6/6**; existing runner/repository remain bounded by batch + statement timeout | **CLOSED_SOURCE** |
| Administrative audit retention | Accepted technical-beta category: 90-day `ADMIN_AI_REGISTRY` only; unknown classes retained; live purge opt-in only | Current audit-retention PostgreSQL **2/2**; source remains category/action/actor/target fail-closed and worker is default-disabled | **CLOSED_SOURCE / LIVE_PURGE_NOT_AUTHORIZED** |

## Source correction made by this pass

Only a regression test was needed; no production bootstrap code changed:

`tests/integration/server/p3-4-bootstrap.integration.test.ts`

New scenario:

`keeps an older v1 client on v1 authority after a newer v2 catalog is published`

The v2 config is deliberately newer globally. The test therefore catches a contract-agnostic “latest config wins” regression while proving the existing server implementation keeps authority separated by contract.

Targeted disposable PostgreSQL result:

- P3.4 bootstrap: **16/16 PASS**
- resource job exit 0; cleanup verified

## Current-tree targeted security / retention evidence

Sequential B disposable PostgreSQL results:

- P2 auth: **14/14 PASS**
- P2.4 token core: **12/12 PASS**
- P2.5 device management: **8/8 PASS**
- S1.1 beta admission: **12/12 PASS**
- feedback/support retention: **6/6 PASS**
- administrative audit retention: **2/2 PASS**

One first retention command used a nonexistent filename and ended with `No test files found`; it did not execute product tests and is not acceptance evidence. The two exact retention files were then run separately through `B heavy --db` and both passed as recorded above.
## Boundaries not closed by this B06 source audit

These are not silently converted into B source defects or PASS:

1. **Live owner-test/preprod deployment and migration** — separate C06/C07 authorization/runbook boundary. No live mutation was performed here.
2. **Installed-browser / ordinary reviewer E2E / store submission** — external release evidence owned by A/C/store flow, not inferred from server tests.
3. **Marketplace credential import into installed owner profile** — remains dependent on ordinary owner profile authentication; no fixture/old-owner bypass.
4. **Commercial 24h refresh + paidThrough+72h offline policy** — explicitly approved target requirement in `SUBSCRIPTION_ACCESS_POLICY.md` / controller notice `SUBSCRIPTION-NETWORK-REVIEW-20260924`, but not implemented/accepted by this free-beta B06 task. No new licensing cron/service or synthetic beta-commercial gate was added.
5. **Live retention cleanup** — feedback/admin retention source behavior is tested, but no live/historical purge is authorized or executed.
6. **Disconnected revoke observability** — a powered-off/offline installation cannot learn a newly issued server revoke until a permitted refresh/reconcile event. The product contract explicitly does not promise instantaneous remote cleanup while offline.

## Conclusion

For the audited **free-beta server B06** boundaries, the current source has no confirmed remaining defect in:
- v1/v2 bootstrap compatibility,
- existing-account beta access,
- refresh/session/device revoke and expiry behavior,
- bounded feedback retention,
- bounded administrative-audit retention.

The only missing source evidence found in this pass was simultaneous old-v1/new-v2 catalog coexistence; it is now covered by the new regression test. Remaining gates above are external/live/commercially deferred and remain explicitly separate.

No live DB change, deploy, beta opening, retention purge, store action, payment action or package publication was performed.
