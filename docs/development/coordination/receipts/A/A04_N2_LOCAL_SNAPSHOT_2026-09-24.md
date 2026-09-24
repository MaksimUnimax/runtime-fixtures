# A04 / N2 local canonical sync + snapshot handling — 2026-09-24

Role: A
Status: SOURCE + PACKAGE REGRESSION PASS / NOT SERVER-INTEGRATED / NOT LIVE
Base HEAD: `50c252cae9c2410276c38423df72e9e9dc796238`
Authority: `FLOW_UNBLOCK_ASSIGNMENT_2026-09-24.md`

Implemented in A-owned paths:
- binding journal identity is locally canonical: `conversation:<sha256(normalized origin|conversation_id)>`;
- existing pending legacy journal rows normalize locally to the canonical entity while retaining their exact old wire entity for replay;
- current production request shape is preserved: no `readEntityIds`, and binding mutations still send the legacy wire entity until server-first rollout is accepted;
- server revision/state/reconciliation knowledge is account-scoped locally;
- snapshot read intents are fenced to account, installation, conversation and local binding/store context;
- compatible remote binding metadata can be adopted only when the matching local store credentials exist;
- incompatible binding/store state becomes explicit conflict; remote metadata never imports marketplace credentials;
- stale snapshot revisions are rejected; FINISH/newer explicit state dominates late delivery markers;
- responses after account/installation/dialogue/local-fence change are ignored rather than applied.

No raw conversation ID is persisted in sync payload/state keys; the canonical digest is used.
No heartbeat, polling loop, websocket or per-command read was introduced.

## Evidence

Committed N2 checkpoint `78c7f4c8019c04635c4bfe6f0748d6f9dd244919` had a complete I1-C1 PASS before the follow-up hardening below. The follow-up was triggered by fresh reruns that exposed two ordering regressions: store-change confirmation was being pre-empted by an N2 local fence, and pending local FINISH incorrectly blocked explicit offline Resume. Both were corrected without weakening server-known FINISH/conflict fences.

Current exact development package:
- deterministic ZIP SHA-256 `5730f4f17c64be693b3585838f539896319abc9ab28089c788fa6b4fefacdc09`;
- repeat archive match = true; source/extracted bytes match = true;
- build resource receipt `dc823717c81749c8a65ad7eb3627310f`: exit 0, peak 26 MiB, OOM 0, cleanup verified.

Current source and extracted package each PASS:
- `application`: 16/16;
- `client-a04-n2-local-snapshot`: 13/13;
- `client-c3e-sync-journal`: 6/6;
- `client-c3f-reconciliation`: 28/28;
- `client-c3g-corrected-predispatch`: 12/12;
- `client-c3h-corrected-autonomy-full-acceptance`: 50/50;
- native Chromium-family browser proof: PASS on both source and extracted package, runtime SHA-256 `4b5173a0eb0de390de4b9b6ea117d103f0a828821b326b8d782bc174ea868205`.

Final extracted-package C3G+C3H resource receipt `4def67d36f6945c5a162f98693d7863e`: exit 0, peak 282066944 bytes, OOM 0, cleanup verified.
Evidence root: `/root/octoport-control/logs/A/a04-n2-local-newchat-20260924`.

Earlier interrupted/incorrect invocations are retained as evidence but are not PASS claims: one used the build parent rather than nested runtime and failed before product execution; two long I1 reruns lost the resource-owner process after partial progress. Their concrete product regressions were reproduced, fixed, and covered by the exact current source/package checks above.

## Remaining boundary

This candidate deliberately does not send snapshot reads on the production wire. Enabling `readEntityIds` and performing final cross-browser/server acceptance remains gated on accepted server-first N2 support and C integration. Firefox AMO optional technical-data opt-out remains a separate open publication blocker. Existing Opera reviewer images/handoff are unchanged and must not be regenerated without cause.
