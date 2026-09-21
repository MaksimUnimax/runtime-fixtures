# S1.2 own-SMTP source consolidation — 2026-09-21

Work ID: `S1_2_R1_20260921_OWN_SMTP_SOURCE_CONSOLIDATION`

This is a bounded source-lineage consolidation. It brings the already
implemented Seller Agents own-SMTP application path onto the accepted M1-C
line. It does not redesign Exim, claim Internet delivery, create a test sink,
or mark S1.2 end-to-end accepted.

## Git and worktree boundaries

- Accepted target start: `17f544cd423b4279ee7648ed31099834338f4430`, tree
  `43f3e1929f5d12b25762b51c5aad246e11e4a309`.
- Historical SMTP source worktree: `/root/runtime-fixtures`, start
  `9db71a1479debcac94ab6e98b3f24b952afbde54`, tree
  `2888fa4f9d9873d969ee18dc33cc70990ea3a583`, branch
  `feature/q1-b-browser-family-matrix-2026-09-19`.
- Consolidation worktree/branch: `feature/s1-2-own-smtp-source-consolidation-2026-09-21`.
- The historical SMTP worktree was left dirty and untouched. No reset, clean,
  stash, rebase, amend, or destructive cleanup was used.

## Complete inventory and classification

The historical dirty tracked files were classified as follows:

| Path | Classification | Action |
|---|---|---|
| `.env.example` | `S1_2_REQUIRED_CONFIG_TEMPLATE` | Ported local Exim defaults and sender settings |
| `apps/worker/src/otp-runner.ts` | `S1_2_REQUIRED_APPLICATION_SOURCE` | Ported provider-outcome classification and bounded retry behavior |
| `packages/server/email/src/index.ts` | `S1_2_REQUIRED_APPLICATION_SOURCE` | Ported provider-neutral SMTP adapter |
| `packages/server/email/src/index.test.ts` | `S1_2_REQUIRED_TEST` | Ported own-SMTP and outcome tests |
| `docs/development/S1_2_OCTOPORT_OWN_SMTP_COMPLETION_20260921.md` | `S1_2_REQUIRED_DOCUMENTATION` | Reconciled into this source-consolidation receipt; not copied as a separate stale acceptance claim |
| `docs/development/PROVISIONAL_OWNER_REVIEW-S1_2_EMAIL_PROVIDER-20260919.md` | `S1_2_REQUIRED_DOCUMENTATION` | Historical Resend decision remains superseded and is not active runtime authority |
| untracked `repro/`, package workspace entries | `UNRELATED_PREEXISTING_CHANGE` / temporary evidence | Not ported |
| `/etc/exim4`, queue, certificates, DKIM/TLS private material | `SYSTEM_ONLY_EXIM_STATE` / `SECRET_MATERIAL` | Not copied into Git |

No migration, lockfile, Stream-2 path, Business Bridge file, extension
artifact, or public API contract was required by the application transport
change. Migrations 0019 and 0020 remain from the accepted line.

## Application architecture

The consolidated active path is:

`OTP domain → provider-neutral EmailProvider → Nodemailer SMTP adapter → 127.0.0.1:25 → project-owned Exim → recipient MX`

The adapter has bounded connection, greeting, socket, and submission timeout
configuration. It sends explicit envelope sender and `From` identity:
`Seller Agents / Octoport <no-reply@octoport.ru>`, with subject `login
verification code` and text/plain OTP content. A stable logical delivery
Message-ID is used. The adapter classifies known SMTP responses, protocol
failures, and ambiguous timeout/reset outcomes without exposing provider
details.

The worker retains the existing OTP job budget and does not retry ambiguous
outcomes. Retryable known 4xx outcomes remain bounded; 5xx, protocol, and
unknown outcomes become terminal for that logical delivery. No provider SDK or
provider HTTP API is active.

Focused search found no active Resend, SendGrid, or Mailgun runtime dependency
in application source, manifests, or lockfile. Remaining textual `resend`
matches are historical/documentary or unrelated extension evidence, not mail
transport authority. The historical provider decision is explicitly
`SUPERSEDED_BY_OWNER`.

## OTP and privacy boundary

The transport change preserves the accepted OTP semantics: ten-minute TTL,
60-second resend cooldown, five failed attempts, server-side protected
storage, single use, account binding, and session creation only after valid
verification. OTP plaintext is not written to normal logs, audit, support,
analytics, OpenAPI examples, or this evidence. Provider errors are opaque to
callers and do not include SMTP credentials or OTP values.

## Exim and Internet-delivery boundary

This task made no Exim mutation. Read-only VPS observation at execution time
reported Exim 4.95 active, `primary_hostname = mail.octoport.ru`, and local
listeners on TCP 25, 465, and 587. The existing local application submission
and non-open-relay repair are treated as prior infrastructure evidence, not
repeated redesign work. Business Bridge was not restarted or modified.

Public metadata observed during this task:

- SPF: one live record, `v=spf1 ip4:78.17.68.165 a mx ~all`.
- DKIM selector: `s1-20260921`; public TXT resolves. The private key was not
  read, copied, or committed.
- DMARC: live `v=DMARC1; p=none`.
- PTR: no answer was observed for `78.17.68.165`; required value remains
  `mail.octoport.ru`.
- Existing Exim queue contains inherited deferred/frozen messages. They were
  only observed and not deleted or used as delivery evidence.
- A no-DATA loopback SMTP probe accepted `MAIL FROM` and an external-domain
  `RCPT TO`, then quit; this proves the local application submission boundary
  without creating a message or mailbox. The remote relay policy was not
  loosened.
- Direct TCP/25 banner probes to Gmail, Outlook, and Yandex MX hosts all
  timed out (`rc=124`). This is consistent with the known upstream VPS SMTP
  egress block. No Internet delivery or real mailbox receipt is claimed.

The acceptance levels remain distinct: application tests and local-MTA
handoff are repository/server evidence; Internet MX delivery and real owner
mailbox receipt are still pending external acceptance.

## Regression and compatibility

Node `v24.20.0` with pnpm `10.34.5` is the execution baseline. Focused email
tests passed (1 file/9 tests) and worker tests passed (4 files/16 tests). The
full workspace test passed, including API (19 files/231 tests), B2/M1 package
tests, Bootstrap, auth, admin RBAC/audit, and Bridge guard. PostgreSQL passed
against the loopback test container after migration verification through 0020
(41 files/1,536 tests). Typecheck, lint, format, Node 24 builds, OpenAPI
check, and docs check passed. No source migration was added.

No API or extension contract changed. Therefore the existing owner Chromium
package remains compatible by contract; the recorded package SHA remains
`bfdb6f67b0abb7efd1f7892382e2b1c8c16c07c957e0567d247ef143091f61be`.

## Remaining live acceptance procedure

S1.2 must not be marked end-to-end accepted until all of the following are
truthfully completed: AdminVPS outbound TCP/25 unblock, PTR publication or
verification for `78.17.68.165 → mail.octoport.ru`, public DKIM/DMARC
verification as needed, a real external MX acceptance, and receipt/validation
of an OTP in the owner's real mailbox. No test mailbox, console OTP, database
OTP extraction, bypass, second SMTP server, or third-party relay substitutes
for that procedure.

Recommended disposition: `S1_2_SOURCE_CONSOLIDATION_PARTIAL_EXTERNAL_DELIVERY_PENDING`.
This is a recommendation for architect review, not self-acceptance.
