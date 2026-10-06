

# A01 — Popup Finish→Start busy race R1 — 2026-10-06

Task: `A01-POPUP-FINISH-START-BUSY-RACE-R1-20261006`

Base: `8d4d95fab213f932981ba7f5e9daf0045d28b47c`.

Evidence level: **SOURCE + INSTALLED_SYNTHETIC**. No live server/catalog/auth/provider/store mutation.

## Defect

A real popup race existed between Finish and a subsequent Start. `action()` kept its local `busy` flag true until the Finish refresh/finally completed, but `render()` did not bind Start readiness to `busy`. Therefore backend state could already be inactive and Start could appear enabled while `busy === true`; a fast Start click then hit `if (busy && !interrupt) return` and was silently discarded.

The deterministic pre-fix evidence is:

- `/root/octoport-control/logs/C/popup-finish-start-race-20261006/RESULT.json`
- SHA-256 `32324b8b640bccdb3d16bd4892fcebb3cd339b2ebd791aeb4d82a13f077f7c5c`
- observed: Start-visible + busy=true + Start handler not run + no explicit failure.

## Fix

`apps/extension/src/application/popup.js` now:

- reports a busy non-interrupt action explicitly as `BUSY_REJECTED` instead of silently returning;
- renders immediately when an action becomes busy;
- keeps Start, Work Resume and Visibility disabled while busy;
- clears busy in `finally` and renders again so controls become actionable only after the action really completed;
- guards the two `render()` calls for source-extraction/unit contexts where the isolated `action()` helper is evaluated without the full popup renderer, without changing full-popup behavior;
- preserves `interrupt: true` behavior for Finish.

`browser_start_entry.py` now waits for the actual Start control to become enabled after Finish rather than relying only on backend `work_active=false`.

`conversation-binding-lifecycle.mjs` contains a deterministic regression for the exact Finish-refresh window: while the Finish action is still busy, the next non-interrupt Start cannot execute silently and receives the explicit busy result.

## Exact verification

Current minimal source bytes passed:

- conversation binding lifecycle: PASS, including `real-popup-finish-refresh-cannot-silently-drop-next-start`;
- native `browser_start_entry.py`: **10/10 PASS**, including existing-dialogue restart and WB path;
- full Extension I1-C1 gate after the render-guard hardening: **171/171 PASS** for source and packaged runtimes;
- Python `py_compile`: PASS;
- `git diff --check`: PASS.

Exact evidence:

- full I1 summary: `/root/octoport-control/logs/C/a01-popup-finish-start-busy-race-r1-20261006/i1-render-guard-exact/summary.json`, SHA-256 `10de269bf7b93ac985608a55b977586e271a8ff8e8647b12fccb9553669c733b`;
- full I1 gates: `/root/octoport-control/logs/C/a01-popup-finish-start-busy-race-r1-20261006/i1-render-guard-exact/gates.json`, SHA-256 `f70642ddaf1689fbf1d49e233e553979142cf61a97b2ad17219c80e9e9433a69`;
- focused popup regression: `/root/octoport-control/logs/C/a01-popup-finish-start-busy-race-r1-20261006/focused-render-guard.log`, SHA-256 `59a392ae633b35355088d01fd4c9127ae6b8ec7ad8f42b52f6b991f0256bfedd`;
- Start diagnostics regression: `/root/octoport-control/logs/C/a01-popup-finish-start-busy-race-r1-20261006/start-diagnostics-render-guard.log`, SHA-256 `b891d9a873b1f6a5c2c273a3e88725c3556c1d98b1f33c77ad5e839e90d754fc`.

An earlier full-I1 attempt stopped only because the clean worktree had no local `tsx` binary. No product gate had failed. The final render-guard rerun used the already installed repository dependency tree read-only and completed 171/171; no dependency installation, lockfile change or source substitution occurred. The final executable bytes were first accepted on `ecae3227...` as candidate `105d373a...`. Before publication, `main` advanced only through disjoint browser-generic transition tooling at `8d4d95fa...`; none of the four A01 task paths changed. These same reviewed executable bytes are therefore reconstructed as a new clean single-parent successor directly on `8d4d95fa...`. Earlier `da001b28...` and `105d373a...` commits are preserved intermediate evidence only and are not the publication candidate.

## Non-claims

This task does not prove ordinary Chrome authentication, live Chrome policy/profile/assignment activation, marketplace credentials, provider reads, LIVE_OWNER useful flow, deployment or production readiness. Those remain separate gates.
