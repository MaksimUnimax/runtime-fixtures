# Controller assignment: cached v3 hard deadline before short expiry

Date: 2026-09-27. Audit: STREAMS-AUDIT-20260927-1022.
Base: 22473b416949892d66e5d8e204805ea84347c329.
Author: controller, isolated worktree. Integrator: C.

Temporarily reserved paths: packages/control-client/src/autonomous-work-authority.js (freshness only); tests/regression/extension-core/client-i1/client-v3-passive-autonomous-authority.mjs (focused deadline regression); this receipt. A continues its existing client.js and technical-scheduler.js work independently.

Reproduction: a valid signed COMMERCIAL GRACE authority has paidThrough 72h before 00:10, offlineHardUntil 00:10 and short expiresAt 00:15. On exact accepted passive A runtime the autonomous evaluator returns allowed:true/FRESH for CACHE at 00:10 and through 00:14:59.999. Zero network calls; signature verified. The existing regression only placed expiresAt before hard and therefore missed this ordering.

Contract: cached commercial authority denies at its fixed hard deadline even while the signed response is otherwise fresh. A current permitting ONLINE response may continue until its own expiry under server business GRACE. Preserve v1/v2, BETA and TRIAL semantics. No licensing service, clock redesign, new server request or live activation.

Evidence: /root/octoport-control/incidents/streams-audit-20260927T1022Z/v3-hard-before-expiry-{repro.mjs,result.json}.

Validation boundary: add signed hard-before-expiry and equal-boundary regressions; retain existing hard-after-expiry tests and ONLINE distinction. Run the focused VM harness on a private copy of the existing accepted assembled runtime with only the exact authority source replacement. This is source/assembled-fixture evidence, not a new packaged or installed acceptance. C runs normal candidate checks before main.
