# A04 installed restart no-replay — 2026-10-01

Status: **PASS — INSTALLED_SYNTHETIC / LOCAL DEVELOPMENT; NOT LIVE_OWNER**.

Task: `A04-INSTALLED-RESTART-NO-REPLAY`.
Parent base: `8376d10876d53fe19dc4c3760dd77743e96b1ae3`.
Changed harness: `tests/regression/extension-core/client-i1/installed_local_integration.py`.
Final harness SHA256: `0b324d354b13ad8f812fa16179d6cc6c32f8c0649fdec1a07e8c8ba4b86c1ea7`.
Exact diff SHA256: `d687a51d5456a3920e5e55ee2665d17d52699a37afd79d20b3d3c91793ca4e4f`.

Supervised evidence: `/root/octoport-control/logs/C/a04-installed-restart-no-replay-r2/result.json`.
Resource receipt: `/root/octoport-control/resource-jobs/59fabfc1babe427397eb69872a9f15c6/receipt.json`.
Result: PASS; exit 0; cleanup verified; OOM 0; provider calls 0.
LOCAL DEVELOPMENT package SHA256: `08e07dd4a069cf63abae6e5058e045f2adca59fbdb75847f61d8be671959b816`.

After full persistent-browser/MV3 restart the harness first proves the same account, device/session, store IDs, work revision, start intent, conversation/origin and active state. The new worker is instrumented before opening the restarted ChatGPT fixture, so every worker `chrome.tabs.sendMessage` to that tab is observed. The test waits until the restarted content runtime answers `OZ_PAGE_CONTEXT`, then requires: pending Work Starts = 0, `OZ_WORK_SEND_INITIAL_PROMPT` dispatches = 0, and fixture `window.sent` = 0. No arbitrary post-restore sleep is used.

Independent review R1: `/root/octoport-control/logs/C/a04-installed-restart-no-replay-review-20261001-result.md` — **REWORK_REQUIRED** for a fixed 1.5s window and insufficient dispatch proof.
Independent review R2: `/root/octoport-control/logs/C/a04-installed-restart-no-replay-review-r2-20261001-result.md` — **PASS** on the exact final diff; reviewer confirmed the state/message boundary and no remaining false-pass path for the requested restart/content-sync scenario.

Linked feedback: `OWNER-START-OPERA-0_2_9-20260930`. This evidence closes only the installed synthetic restart/no-replay criterion. It does **not** mark the operator feedback manually accepted and does not prove Opera LIVE_OWNER behavior.

Limitations: synthetic beta fixture; generated local OTP; deterministic ChatGPT fixture; no real email, provider business call, STORE package compatibility, deployment, store submission or production mutation. No product runtime/auth/workAllowed/signature/CSRF/TTL behavior changed.
