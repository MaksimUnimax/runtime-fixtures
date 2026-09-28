# C — monitoring Russian/no-resend batch — 2026-09-28

Status: **INTEGRATED SOURCE CANDIDATE / LOCAL PACKAGE PASS / BRANCH CI REQUIRED / NO LIVE DEPLOYMENT**

Base main before this batch: `1ddc91941b28ce18327094dafabfa0c47c2f2e7a`.

C integrated the exact controller chain:
- `736300e89d2f3c5649356b457f4a7fc7675a771f` — bounded Russian monitoring result explanation;
- `b5122beb72ce2943f702e51763bdafceb9212578` — authenticated scheduler ambiguous exception/timeout no-resend fence;
- `b7de6d61ba1c08abf5612e1a5aacc576ffb8d1ca` — Health incident Telegram Russian formatter.

C then wired only `TelegramOperatorService.notify()` to `explainMonitoringResult()`, preserving transport, keyboard, polling, retry, dedup and schedule behavior. Telegram fixture was corrected to the actual production Swagger runner code `API_SOURCE_UNAVAILABLE`; generic unknown result codes still fail safe and do not invent a cause.

Local parent-tree acceptance under resource supervision:
- Telegram operator: 93/93 PASS, typecheck PASS;
- Health: 184/184 PASS, including scheduler no-resend and repair-approval tests, typecheck PASS;
- Worker: 57/57 PASS, typecheck PASS;
- Prettier targeted paths PASS; `git diff --check` PASS;
- combined parent supervisor `octoport-test-c-cddcb0c203714cfdb8aa225246fb8e57.service`: exit 0, OOM 0, cleanup verified, peak 746,586,112 bytes.

Important behavior boundaries:
- rejected authenticated executor promise without proof of pre-send failure becomes terminal `SEND_UNCERTAIN`; public/no-session retry semantics are preserved;
- deadline timer is cleared when execution settles;
- Telegram result text no longer exposes run IDs, raw result summary or technical English for bounded result notifications;
- Health Telegram text distinguishes page observation from controlled behavior/installed acceptance and does not claim a patch was applied merely because an incident recovered.

Evidence is SOURCE/package tests only. No Telegram message was sent, no service restarted, no monitoring DB changed, no poller added, authenticated H3 remains disabled, and product API/worker/portal were not switched by this batch.
