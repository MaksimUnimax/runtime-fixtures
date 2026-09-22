# S1.2 / Q1-C live SMTP + OTP closure — 2026-09-22

Work ID: `S1_Q1C_LIVE_SMTP_OTP_CLOSURE_2026-09-22`

Status: `S1_Q1C_LIVE_SMTP_OTP_ENVIRONMENT_BLOCKED`

This is a bounded Stream-1 operational receipt. It does not repeat the
35-card Q1-C scan and does not modify Stream 2. The executor used the
dedicated worktree/branch `work/stream1-q1c-live-smtp-otp-2026-09-22`, based
on the local Q1-C preparation authority `aba4726a73d736ceef0c8b1798aace6dda4cfe35`.
The prior authority commit supplied for this task,
`b273309dd4c1ac4902a6f56856108858795605ef`, is not present in the local Git
object database; it was not recreated, rewritten, or substituted as a local
commit.

## AdminVPS actions

The owner-authoritative external actions are recorded as complete:

```text
ADMINVPS_OUTBOUND_TCP25_ACTION = DONE
ADMINVPS_PTR_ACTION = DONE
PTR = 78.17.68.165 -> mail.octoport.ru
```

Public DNS observed at `2026-09-22T05:57:38+03:00`:

- `mail.octoport.ru A` -> `78.17.68.165`;
- `octoport.ru MX` -> `10 mail.octoport.ru`;
- reverse DNS -> `mail.octoport.ru`;
- SPF -> `v=spf1 ip4:78.17.68.165 a mx ~all`;
- DKIM selector `s1-20260921` -> a public RSA key record;
- DMARC -> `v=DMARC1; p=none`.

No AdminVPS request is reopened.

## Live mail observations

The current Q1-C runbook identifies the intended deployment as
`https://api.octoport.ru` / `https://app.octoport.ru`, with the worker path
submitting to local SMTP `127.0.0.1:25` and the project-owned Exim instance
delivering as `mail.octoport.ru`.

The public mail host was reachable from the execution host:

- TCP 25: Exim 4.95 greeting; STARTTLS completed with TLS 1.3 and certificate
  verification succeeded.
- TCP 465: implicit TLS completed with TLS 1.3 and certificate verification
  succeeded.
- TCP 587: STARTTLS completed with TLS 1.3 and certificate verification
  succeeded.
- A no-DATA public relay-policy probe did not submit a message; the public
  host rejected the probe sender as an unknown user. No relay policy was
  weakened and no queue item was created by this task.

The following bounded TCP/25 probes also completed from the execution host,
not from the VPS network namespace:

| Target MX | Address | Result | Timestamp |
|---|---:|---|---|
| `gmail-smtp-in.l.google.com` | `172.217.218.27` | TCP connect and SMTP greeting PASS | `2026-09-22T05:57:38+03:00` |
| `outlook-com.olc.protection.outlook.com` | `52.101.41.181` | TCP connect and SMTP greeting PASS | `2026-09-22T05:57:39+03:00` |
| `mx.yandex.ru` | `77.88.21.249` | TCP connect and SMTP greeting PASS | `2026-09-22T05:57:39+03:00` |

These are not VPS-path delivery evidence. No authenticated SSH session to
`root@78.17.68.165` was available with the existing local keys, so the
following actual-host checks could not be performed: systemd MTA state,
deployed Exim configuration, live queue state, and outbound TCP/25 from the
network path used by the worker.

```text
OUTBOUND_TCP25_OPERATIONAL = NOT_PROVABLE_FROM_VPS
MTA = PUBLIC_EXIM_OBSERVED; SYSTEMD_STATE_NOT_OBSERVED
QUEUE = NOT_OBSERVED_ON_VPS
SPF = PASS (PUBLIC_DNS)
DKIM = PASS (PUBLIC_DNS_KEY_PRESENT; SIGNATURE_NOT_OBSERVED)
DMARC = PASS (PUBLIC_DNS_RECORD_PRESENT; AUTH_RESULT_NOT_OBSERVED)
REMOTE_MX_ACCEPTANCE = NOT_PROVABLE
```

The public HTTPS deployment remained reachable during the check:

- `https://api.octoport.ru/health/ready` -> HTTP 200;
- `https://app.octoport.ru/` -> HTTP 200.

## Real delivery and Q1C-OTP-01

No authorized test mailbox or mailbox access was present in the local
executor environment. No recipient was invented, no real message was sent,
and no OTP request was generated. Consequently the live sequence stopped
before the first application OTP action:

```text
REAL_DELIVERY_LOCAL_ACCEPTANCE = NOT_RUN
REAL_DELIVERY_REMOTE_MX_ACCEPTANCE = NOT_PROVABLE
EXTERNAL_MAILBOX_RECEIPT = OWNER_DEFERRED
AUTHENTICATION_HEADERS = NOT_OBSERVED

Q1C-OTP-01_REQUEST = NOT_RUN
Q1C-OTP-01_MAIL_SEND = NOT_REACHED
Q1C-OTP-01_RECEIPT = OWNER_DEFERRED
Q1C-OTP-01_VERIFY = NOT_REACHED
AUTH_SESSION = NOT_REACHED
BOOTSTRAP_AFTER_AUTH = NOT_REACHED
```

This is not an OTP acceptance. OTP values, credentials, cookies, tokens,
session material, and private message contents were not read or stored.

## Regression

The execution host provides Node `22.22.2`, while the accepted baseline
specifies Node `24.20.0`; pnpm therefore emitted the expected engine warning.
The lockfile install was offline and frozen. Focused regression results:

| Scope | Test files | Tests | Result |
|---|---:|---:|---|
| `@product/email` | 1 | 9 | PASS |
| `@product/worker` | 4 | 16 | PASS |
| `@product/auth` | 1 | 9 | PASS |
| `@product/device-auth` | 1 | 9 | PASS |
| `@product/extension-auth` | 1 | 10 | PASS |
| `@product/bootstrap` | 5 | 60 | PASS |
| `@product/api` | 19 | 231 | PASS |
| **Total** | **32** | **344** | **PASS 344 / FAIL 0** |

Typecheck passed for all seven focused packages. Lint plus Bridge boundary,
format check, docs check, OpenAPI check, and the API/worker/health-runner/
portal/admin build all passed. `git diff --check` passed. No migration or
runtime source change was made. Existing broader regression counts remain
historical evidence in the source-consolidation and preprod receipts.

Bounded live checks in this receipt: `PASS 17`, `FAIL 0`, `NOT_PROVABLE/
DEFERRED 9` (nine public DNS observations, three public SMTP listeners/TLS
observations, three remote-MX connect/greeting probes, and two HTTPS health
checks are included in the PASS count; no SMTP DATA or OTP was sent).

## Security/privacy

No secret was printed, committed, or copied. No mailbox password, OTP,
session cookie, auth token, private key, raw message, recipient address, or
provider credential appears in this receipt. No Stream-2 path was modified.

## Remaining blockers and dependency-correct next step

1. Obtain legitimate operator access to the actual VPS/network path and run
   one bounded outbound TCP/25 test to resolved destination MX hosts; inspect
   the actual MTA/queue without changing relay policy.
2. Provide/use one already-authorized real owner mailbox, then execute
   `Q1C-OTP-01` exactly once through `https://app.octoport.ru`: request OTP,
   verify actual mailbox receipt, enter it, and verify session/device/
   Bootstrap. Return only sanitized evidence.

The exact remaining acceptance boundary is `OWNER_LIVE_MAILBOX_TEST` plus
`VPS_PATH_OPERATIONAL_SMTP_TEST`. No roadmap step beyond this bounded
Stream-1 acceptance is started.

Recommendation: `S1_Q1C_LIVE_SMTP_OTP_ENVIRONMENT_BLOCKED`
