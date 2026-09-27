# Controller audit — 2026-09-27 12:01 +05

Scope: active A/B/C workstreams, source/evidence, integration and first-store readiness. No resource/disk audit, cleanup, live mutation or main publication by controller.

## First-submit ordering correction

A03_STORE1_USEFUL_REVIEWER_PREPARATION_2026-09-27.md previously put ordinary Opera Add-ons installation with Developer Mode off before the first reviewer acceptance. Read literally, that creates an impossible dependency: publication is required before the first Submit.

Correct order:
1. Test the exact frozen STORE archive through a legitimate pre-submission developer/review installation path, preserving its bytes, trust bundle, normal account/device auth and supported identity/origin handling.
2. Prove the real declared useful scenario and a reviewer-accessible instruction path. A fixture key, test bootstrap or synthetic provider is not that proof.
3. Submit the exact reviewed candidate once STORE_POLICY minimum is met.
4. After store approval/distribution, verify normal catalogue installation and N-to-N+1 with stable item identity. Those remain open until observed.

This changes sequencing only. It does not relax auth, package identity, signed authority, privacy, useful functionality or the requirement that moderators can reproduce the submitted extension. A draft item or a pre-submit developer install is not publication.

Official sources inspected on 2026-09-27:
- https://help.opera.com/en/extensions/publishing-guidelines/
- https://help.opera.com/en/extensions/basics/
- https://help.opera.com/en/extensions/acceptance-criteria/

## A — confirmed WB request-contract discrepancy

On main84c3ba00, executing the actual frozen WB registry/contract/guidance modules without network showed:
- fbs_order_statuses.body_required=false;
- guidance publishes template_runnable=true for params={};
- normalizeCommand accepts that command and emits no body.

The official API operation is a status lookup for specified order IDs. A's current source receipt records a required orders array; direct official-page retrieval during this controller check returned498. Reconfirm exact current cardinality from a retrievable authoritative snapshot; do not fabricate freshness or silently reuse another operation's100 limit.

A is assigned the smallest correction in its current provider/composition/validation allowlist. Frozen migration/reference bytes remain immutable. Preserve load order if an effective registry override is used; WBContract and guidance must see the corrected metadata before capturing it. Requiring body=true alone is insufficient if empty direct params normalize to {}: validate the required IDs and zero-transport denial as well.

The narrow first-store seller_info scenario is distinct. C evaluates actual reachable impact on published functionality; never erase the known FBS gap or silently replace frozen0.2.4 package bytes.

## B — work available while C v3 is pending

B07/B08 source is in main84c3ba00. The P5.7 fixture clock correction is test-only and preserves the post-lock production change.

B owns B09_STORE1_SIGNATURE_PREFLIGHT, with exact paths in the runtime controller assignment:
- tooling/server/store1-v2-signature-preflight.ts and .test.ts;
- existing store1-opera-admin-activation.ts and tests;
- its integration test and B receipts.

Use C's completed read-only signature-preflight analysis as an input, not as live proof. The helper must bind the accepted STORE ZIP/trust verifier, current admin config/key metadata and an ordinary authenticated no-detectedAi v2 bootstrap envelope. Wrong signature/key/config/subject/context, malformed canonical payload, stale proof or mismatched artifact must fail before every catalogue POST. Preserve independent reviewer/admission checks.

Use existing protected credential input and redacted evidence. Source/disposable validation is authorized; live requests, catalogue writes, identity creation, SQL bypass or enrollment changes are not authorized by this assignment. C does not concurrently implement the same B09 paths.

## C — integration and shared contract

- main observed84c3ba00 with all five branch checks successful; post-main checks are a separately observed result.
- Batch cumulative A candidates at one stable exact submitted head. Older ancestor submissions are not separate product changes.
- Publish/review the dormant v3 shared foundation and hand exact paths/contract to B/A after applicable checks. Do not enable v3 for frozen0.2.4/control_plane_v2.
- Finish actual reviewer admission/config/readback and worker/portal rollback preparation before asking for a concrete live operation.
- First Submit never waits for all270 business runs, other browsers, future commercial policy or Safari.

## Testing efficiency and status truth

A's multiple131-gate runs accompanied fixture-only additions without a changed runtime. Use focused changed-fixture checks and reuse identical package/browser evidence; retain any required integration gate and run broader checks for a changed runtime or an identified regression.

WAITING_INPUT and RUNNING in JSON are administrative cursors, not proof of present execution. New commits establish actual progress. A new control assignment does not prove a parent dialogue has started it. Preserve STOP and do not invent RUNNING just to make a dashboard green.
