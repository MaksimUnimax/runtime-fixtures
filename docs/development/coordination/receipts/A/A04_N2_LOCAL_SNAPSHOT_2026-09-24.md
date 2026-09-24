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

Focused corrected run:
- `client-a04-n2-local-snapshot`: PASS 10/10;
- `client-c3e-sync-journal`: PASS 6/6;
- `client-c3f-reconciliation`: PASS 28/28;
- `client-c3g-corrected-predispatch`: PASS 12/12;
- resource receipt `b92abc579ff3432e9755e4dd3a06a2aa`: exit 0, peak 118489088 bytes, OOM 0, cleanup verified.

Full I1 gate:
- `tooling/checks/extension_i1.py`: PASS;
- 152 source/package gate processes, including native browser proof, syntax, N2, C3E/F/G/H, signed readback and verifier;
- deterministic package SHA-256 `b1e02082ac1f707ff7add664ded17e2aa1f4a500eccaebd7120d6eaa37ce6be0`;
- source/extracted bytes match and repeat archive match;
- resource receipt `f16b869b52854ee1b34761b76e209365`: exit 0, peak 407896064 bytes, OOM 0, cleanup verified.
- evidence root: `/root/octoport-control/logs/A/a04-n2-i1-full-newchat-20260924`.

One earlier test invocation pointed the harness at the build parent instead of its nested runtime and failed with ENOENT before product execution. It is not product evidence; the corrected focused and full I1 runs above are authoritative.

## Remaining boundary

This candidate deliberately does not send snapshot reads on the production wire. Enabling `readEntityIds` and performing final cross-browser/server acceptance remains gated on accepted server-first N2 support and C integration. Firefox AMO optional technical-data opt-out remains a separate open publication blocker. Existing Opera reviewer images/handoff are unchanged and must not be regenerated without cause.
