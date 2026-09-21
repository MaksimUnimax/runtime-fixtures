# Q1-C Owner/Live Acceptance Runbook

Work ID: `Q1-C0-20260921-OWNER-LIVE-ACCEPTANCE-PREPARATION`

Status: `Q1C_OWNER_LIVE_PREPARATION_READY` (preparation only; Q1-C is not accepted)

## Scope and safety

This runbook is the canonical preparation for the later owner/live gate. No
owner test, owner mailbox request, marketplace credential use, AI session, or
production mutation was performed while preparing it. The owner must execute
one test at a time with the architect: receive one test card, perform it,
return only the requested safe evidence, and wait for classification before the
next card.

Never place OTPs, passwords, marketplace tokens, cookies, storageState, raw
seller reports/files, private AI conversation content, transfer secrets, or
private keys in chat, screenshots, evidence, or diagnostics. Enter marketplace
credentials only into the product UI/local extension. Redact business data in
screenshots.

## Exact baseline

The canonical source baseline is HEAD
`600a6891a47f24eb9a008aa47182e31d5181d260`, tree
`46fb4fd9c4d9ace39267998d0aaa028e096c28da`. The deployed preprod endpoints
are `https://api.octoport.ru` and `https://app.octoport.ru`; the preprod trust
identity is `octoport-preprod-2026-09-19` with public fingerprint
`edc47821df296868c7061069ed50fa742f70a75889bd010dadef5166fadc4645`.

Current owner packages, unchanged because the API/Bootstrap contract is
unchanged:

- Chromium: `SELLER_AGENTS_OWNER_TEST_CHROMIUM_FINAL.zip`, SHA-256
  `bfdb6f67b0abb7efd1f7892382e2b1c8c16c07c957e0567d247ef143091f61be`.
- Firefox: `SELLER_AGENTS_OWNER_TEST_FIREFOX_FINAL.zip`, SHA-256
  `3db61719560acf27e29591efba3852d0df5e16a9328be813f1198082aee8a459`.

Preprod is deployed and healthy through named migration `0020`; Bootstrap,
device activation, B2, M1, local SMTP handoff, and local Exim are already
accepted at their bounded scopes. Free beta is active; commercial and device
commercial enforcement are disabled; checkout is absent.

## Mail gate, checked once for preparation

The active application path remains provider-neutral EmailTransport to local
Exim at `127.0.0.1:25`. DKIM selector `s1-20260921` resolves publicly and
DMARC resolves as `v=DMARC1; p=none`. PTR for `78.17.68.165` returned no
value. A bounded TCP/25 check from this VPS timed out for Gmail, Outlook, and
Yandex MX hosts. Therefore the first executable owner test is blocked by
`BLOCKED_REAL_MAIL`; no OTP was requested and no Internet delivery is claimed.

The external actions are: AdminVPS outbound TCP/25 unblock; PTR
`78.17.68.165 -> mail.octoport.ru`; then a real remote-MX acceptance check and
the owner's real-mailbox receipt. The owner-mailbox receipt remains the only
mailbox-level acceptance step; a sink, DB read, console OTP, or synthetic
delivery is invalid evidence.

## Canonical dependency-aware order

The architect should issue these cards in order, stopping after every card:

1. `Q1C-OTP-01` real OTP, login, device activation, Bootstrap.
2. `Q1C-EXT-03` extension authorization and device binding.
3. `Q1C-BS-04` signed Bootstrap/account binding after reopen.
4. `Q1C-AUTH-02` logout and re-login invalidation.
5. `Q1C-BETA-05` current free-beta/non-commercial UX.
6. `Q1C-OZON-06` add and validate the owner's Ozon store.
7. `Q1C-OZON-07` Ozon Start and one read-only command.
8. `Q1C-OZON-08` Ozon report/file-result delivery.
9. `Q1C-WB-09` add and validate the owner's Wildberries store.
10. `Q1C-WB-10` Wildberries Start and one read-only command.

Continue with the sequence in the interactive script and matrix. Browser
smokes that do not need owner credentials may be run independently after
`Q1C-OTP-01`; they do not convert environment defers into product failures.

## First executable test after mail readiness

Run `Q1C-OTP-01` first, and only after outbound TCP/25 and the PTR/mail
identity gate are genuinely ready. The owner opens the current portal, enters a
real email address, requests an OTP, waits for the actual message in the real
mailbox, enters it, and completes the resulting login/device/Bootstrap flow.
The architect records destination domain, timestamps, provider/MX acceptance,
arrival latency, inbox/spam result, request IDs, and safe account/device IDs
only. The OTP itself is never recorded.

PASS requires: real message accepted by the remote MX, actual mailbox arrival,
correct OTP accepted once, session established, device activation successful,
and signed Bootstrap accepted for the current preprod trust identity. A
provider rejection is `FAIL_PROVIDER`; missing arrival with accepted remote
submission is `FAIL_ENVIRONMENT` or provider-specific after evidence review;
invalid/used/expired-code behavior is a product failure only when the code was
entered from the real message and the reset rules were followed.

## Owner data worksheet

The owner prepares, but does not send in chat:

- one real mailbox for `Q1C-OTP-01`;
- one Ozon seller credential, optional Performance credential, and safe store
  label for Ozon tests;
- one accepted Wildberries credential and safe store label;
- real ChatGPT/Alice sessions only where the owner has authorized them;
- a second legitimate browser/profile/device only for multi-browser tests;
- a second real store in the same marketplace only if available.

If an item is unavailable, mark the specific test `FAIL_OWNER_DATA_UNAVAILABLE`
or the matrix status `BLOCKED_OWNER_CREDENTIAL`; never fabricate it.

## Browser truth

| Target | Current truth | Owner preparation |
|---|---|---|
| Playwright Chromium 151 | canonical bounded automated reference | no duplicate live replay required |
| Real Opera 136 | branded BR-01..24 24/24 bounded automated | optional focused owner smoke; does not reopen automation |
| Real Chrome 147 | branded runtime unpacked-extension route deferred | manual/native route only; classify environment separately |
| Yandex Browser | package ready, runtime/UI gate deferred | manual runtime smoke when legitimate environment exists |
| Firefox | package/runtime ready, privileged extension-page gate deferred | manual WebExtension route when legitimate environment exists |
| Safari | Linux cannot prove it | real macOS/Xcode/Safari required |

## Reconciled owner/deferred ledger

The matrix maps each current live item once:

- `OWNER_DEFERRED_TEST-I1-ONLINE-WORK-HEALTH-20260917` maps across
  `Q1C-OFFLINE-19` (owner-authenticated Start/Resume and authority behavior),
  `Q1C-REBIND-14` (confirmed store-rebind/new Start), and `Q1C-HEALTH-27`
  (passive AI/Work Health provenance); it remains a Stream-2/owner-live
  dependency.
- Real mailbox delivery and owner session creation map to `Q1C-OTP-01` and
  remain `BLOCKED_REAL_MAIL` until AdminVPS TCP/25, PTR, remote-MX acceptance,
  and actual mailbox arrival are proven.
- Real Ozon/Wildberries rights, store identity, two-store cases, and live
  provider results map to `Q1C-OZON-06..08`, `Q1C-WB-09..11`,
  `Q1C-REBIND-14..17`; unavailable owner data is not fabricated.
- Real ChatGPT/Alice sessions and live composer/upload variants map to
  `Q1C-AI-12`; no AI body is retained.
- Owner logout/retain/delete UX maps to `Q1C-AUTH-02` and `Q1C-ACCOUNT-34`.
- Transfer/export/import owner UX maps to `Q1C-TRANSFER-24` and
  `Q1C-EXPORT-25`; the accepted cryptographic cases remain automated.
- Chrome, Yandex, Firefox, and Safari map to `Q1C-CHROME-28` and
  `Q1C-YANDEX-30..Q1C-SAFARI-32`. Opera's actual 24/24 bounded result is
  preserved as automated truth in `Q1C-OPERA-29`.
- The existing Health TTL and D3/S2 transfer/export provisional decisions are
  policy context, not new manual tests. They are not silently reinterpreted as
  owner PASS.

The resulting 35-card matrix has 12 `READY`, 1 `BLOCKED_REAL_MAIL`, 11
`BLOCKED_OWNER_CREDENTIAL`, 5 `BLOCKED_OWNER_BROWSER`, 1 `BLOCKED_REAL_MAC`,
1 `STREAM2_DEPENDENCY`, and 4 `ALREADY_ACCEPTED_AUTOMATED` cards. The first
card is `Q1C-OTP-01`, and its next-test graph is acyclic.

## Test and failure rules

`PASS` means the card's exact result occurred and safe evidence is sufficient.
`FAIL_PRODUCT` means the product behavior contradicts the card after a safe
single retry. `FAIL_ENVIRONMENT` means service/network/platform state blocked
the test. `FAIL_PROVIDER` means a real provider returned the failure.
`FAIL_OWNER_DATA_UNAVAILABLE` means the owner lacks the required legitimate
account/store/session/device. `FAIL_BROWSER_ENVIRONMENT` means the target
browser/OS route is unavailable. `RETRY_SAFE` applies to idempotent read-only
checks or a fresh isolated card; `RETRY_UNSAFE` applies to ambiguous provider
sends, transfer secrets, or state-changing operations until classified.

After a failure, return the card ID, timestamp, browser, safe error class and
request ID. Do not repeat a provider command, OTP request, transfer, or
credential mutation until the architect says it is safe.

## State reset rules

- Dialogue-only: finish/abort the current dialogue and open a new dialogue;
  do not delete the account or browser profile.
- Work-only: use Finish/Abort and confirm no stale command executes.
- Store binding: stop Work, use the explicit store-change flow, acknowledge
  its warning, and perform a new Start.
- Marketplace binding: stop Work, switch marketplace, acknowledge the warning,
  and perform a new Start; old commands must not autorun.
- Extension restart: close/reopen the browser or reopen the dialogue; do not
  remove local state unless the card explicitly requires a clean profile.
- Auth: use product logout, then re-login; do not clear all browser data by
  default.
- Device/session: use the existing product logout/reset path only; never alter
  DB state or read OTPs.
- Support case: use the safe case ID; do not delete unrelated cases.

## Automated evidence not replayed manually

Cache-expiry denial, provider UNKNOWN/no-replay, 429 handling, transfer
cryptographic cases, signed-authority matrices, no-mandatory-call invariants,
and the accepted core browser automation remain automated evidence. The
interactive script marks these as `ALREADY_ACCEPTED_AUTOMATED` unless a live
observation is naturally available. This prevents unsafe provider abuse and
unnecessary duplicate testing.

See the complete one-card script in
[Q1_C_OWNER_INTERACTIVE_TEST_SEQUENCE_2026-09-21.md](Q1_C_OWNER_INTERACTIVE_TEST_SEQUENCE_2026-09-21.md)
and the machine-readable reconciliation at
`docs/development/q1/Q1_C_OWNER_LIVE_MATRIX_2026-09-21.tsv`.

## Preparation conclusion

All remaining Q1-C owner/live gates identified in accepted Q1-A, Q1-B, Q1-D,
B1, B2, S1.2, I1, C2/C3 autonomy, and D3/S2 evidence are represented in the
matrix. No Q1-C pass is claimed. The preparation recommendation is
`Q1C_OWNER_LIVE_PREPARATION_READY`.
