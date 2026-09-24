# A04 network correctness — N6 attachment idle lifecycle — 2026-09-24

Role: A
Task: A04 / controller N6 bounded optimization
Evidence level: SOURCE + PACKAGE/SYNTHETIC
Installed/live acceptance: NOT CLAIMED

## Trigger

Controller N6 review identified that every supported AI tab kept the attachment RPC Port open, reconnected after disconnect, and ran a 60-second recovery loop even with no attachment delivery work. The service worker already emits targeted `OZ_ATTACHMENT_DELIVERY_WAKE` messages from durable storage changes, so the perpetual idle keepalive/poll was redundant.

## Change

- Imported donor files remain byte-unchanged. The active behavior is changed only through deterministic `apps/extension/application-patches.json` composition.
- Idle tabs no longer call `ensurePort()` at content-runtime startup and no longer create `RECOVERY_POLL_MS` / a minute `setInterval`.
- A single bounded 250 ms startup recovery probe remains. It connects on demand, checks durable recovery state, and intentionally disconnects once no RPC/recovery work remains.
- Targeted `OZ_ATTACHMENT_DELIVERY_WAKE` from the existing storage-change worker reconnects from idle and carries the exact owner/delivery identity into recovery.
- The Port stays alive while recovery work or RPC requests are active. An active disconnect gets at most three bounded reconnect attempts; each attempt rereads durable recovery for the exact owner before acting.
- Port-disconnect/post failures during recovery are not prematurely terminalized as attachment failure; they are retried through durable phase readback. Existing committed attachment/Send phases therefore remain the no-replay authority.
- Terminal completion, cancellation, unsupported/failure cleanup, or drained RPC state returns to no Port/no reconnect timer.

## Regression

- New `tests/regression/extension-core/attachment-port-idle.mjs` executes the composed content runtime and proves: one startup probe; no interval/minute poll; idle disconnect; targeted wake reconnect; active disconnect/recovery reconnect; terminal/cancel/failure cleanup back to idle.
- The regression is wired into `extension_core.py` for each composed runtime.
- Parent Node 24.20.0 focused run: new attachment idle lifecycle PASS, full application PASS including APP-07 binary attachment delivery, and client R5 PASS. Resource job `e8bddab0dd524cb0abfeaa8bbb3044f2` exited 0, OOM 0, cleanup verified, peak 166,723,584 bytes. Evidence package `/root/octoport-control/logs/A/a04-n6b-focused-parent`.

## Limits

This is a client/runtime efficiency change only. It does not change N2 sync wire, provider commands, control-server behavior, subscription policy, or live browser/store acceptance. Browser-native lifecycle proof remains separate from this synthetic composed-runtime evidence.
## Independent review follow-up

Read-only Luna review of `74db16d2c1e46f27214797661385061b10a9097d` found no blocking defect in idle cleanup/reconnect itself, but identified one medium correctness gap: a stale targeted wake whose conversation key no longer matched the current page could fall back to unscoped current-conversation recovery. It also noted missing direct evidence for committed-phase no-replay across an active disconnect.

The follow-up fixes the medium gap by making any non-null expectation with a mismatched current conversation return no recovery immediately; it never broadens to an unscoped lookup. Regression now proves a stale wake does not reconnect or issue a new recovery RPC.

The evidence gap is closed for the highest-risk Send phase: a disconnect before committed-Send recovery readback causes a bounded reconnect, rereads the exact durable `attachment_send_committed` owner, performs confirmation only, and never emits `OZ_ATTACHMENT_SEND_COMMIT` again. Existing APP-07/R5 coverage continues to protect the normal binary attachment path and no-replay authority.

Post-review focused Node 24.20.0 evidence `/root/octoport-control/logs/A/a04-n6b-focused-parent-reviewfix2`: attachment idle lifecycle PASS with `staleWakeIgnored=true` and `committedSendNoReplay=true`; application PASS including APP-07; client R5 PASS. Resource job `ce4cbaf2833d44fabc40ccdede1be50b` exited 0, OOM 0, cleanup verified, peak 153,092,096 bytes.

Review evidence: `/root/octoport-control/logs/A/a04-n6b-review-74db16d-result.md`.
