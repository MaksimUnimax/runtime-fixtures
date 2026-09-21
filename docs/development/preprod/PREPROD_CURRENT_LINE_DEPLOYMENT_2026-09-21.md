# Preprod current-line deployment — 2026-09-21

Work ID: `PREPROD_R1_20260921_CURRENT_CONSOLIDATED_LINE_DEPLOYMENT`

Status: `PREPROD_CURRENT_LINE_READY_EXCEPT_EXTERNAL_SMTP`

This receipt records the deployment of the accepted consolidated Stream-1
source to the existing Octoport owner-test/preprod services. It does not claim
production cutover, real Internet OTP delivery, Q1-C acceptance, or S1.2
end-to-end acceptance.

## Source and deployment identity

- Deployment worktree: `/root/runtime-fixtures-preprod-r1`
- Deployment branch: `feature/preprod-current-line-deployment-2026-09-21`
- Source deployed: `600a6891a47f24eb9a008aa47182e31d5181d260`
- Source tree deployed: `46fb4fd9c4d9ace39267998d0aaa028e096c28da`
- Previous runtime worktree: `/root/runtime-fixtures`
- Previous runtime HEAD/tree: `9db71a1479debcac94ab6e98b3f24b952afbde54` /
  `2888fa4f9d9873d969ee18dc33cc70990ea3a583`
- Node: `v24.20.0`
- pnpm: `10.34.5`
- Deployment start: `2026-09-21T12:23:34Z`
- Services switched: API, worker, portal
- Business Bridge was not restarted or modified.

The previous runtime worktree was dirty and was preserved. The clean
deployment worktree was used for install, build, and service execution.

## Initial failure batch and repair

1. `PREPROD_TRUST_CATALOG_DRIFT`: the expected database level was reported as
   18, but the live database already contained the complete repository journal
   through named migration `0020` (21 journal rows, `0000`–`0020`). Normal
   migration execution was therefore a no-op; migration history was not
   forced or rewritten.
2. `DEPLOYMENT_SAFETY_DEFECT`: the first clean-line API restart failed closed
   with `bootstrap signing key metadata binding is invalid`. Read-only
   inspection showed `public.signing_keys` and `public.signing_key_events` were
   empty while the configured existing preprod trust key was present in the
   server secret environment and metadata file. The configured key was not
   replaced or rotated.
3. A contained operator wrapper error was detected during the first repair
   attempt before application activation: its guarded key derivation failed on
   a quoted environment value, but the shell wrapper did not stop. The
   resulting invalid row was immediately captured in a safety dump and the
   exact predeploy backup was restored. A strict Node 24 derivation then
   inserted the correct 44-byte public SPKI, `REGISTERED` and `ACTIVATED`
   events, and safe `SYSTEM` audit records. No private key was stored.
4. `TOPOLOGY_NOTE`: there is no separately exposed Seller Agents admin systemd
   unit or public admin hostname in the current topology. The admin build was
   included and the API admin/support routes are present and RBAC-guarded;
   the public portal remains the deployed portal surface.

After repair, API startup passed and the clean source was activated for all
three Seller Agents services.

## Build and migration gates

Passed under Node 24:

- frozen offline install/lockfile consistency;
- typecheck;
- lint and Bridge guard;
- format check;
- API, worker, health-runner, portal, and admin build;
- OpenAPI check;
- docs check;
- workspace unit tests;
- PostgreSQL integration on a disposable database: 41 files, 1,536 tests.

The disposable database was removed after the integration run. The live
preprod database was not reset by test cleanup.

Predeploy backup:

- path: `/var/backups/seller-agents-owner-test/preprod-r1-20260921T122334Z-migration-0020.dump`
- mode: `0600`
- size: `323689` bytes
- SHA-256: `15a0fff37e3a3b55011409642db7185939bb1b46f16606f852720a5820e348d2`

Additional recovery dump before trust-catalog restoration:

- path: `/var/backups/seller-agents-owner-test/preprod-r1-20260921T122334Z-before-catalog-restore.dump`
- mode: `0600`
- size: `324123` bytes
- SHA-256: `ac8d391e1bd7a78ee0bb04f47951bceaedd47d0dae208ba7bfca21ea3e2ae679`

Migration results:

- before: journal already through named `0020`;
- `0019` B2 feedback/support: present exactly once;
- `0020` M1-C funnel signals: present exactly once;
- post-deploy normal migration command: no-op;
- after: 21 journal rows, latest timestamp `1789706000000`;
- observed preservation: 7 accounts and 7 devices.

## Runtime health

- API service: active, clean worktree path, external `/health/ready` HTTP 200;
- worker service: active and logged `Worker ready`;
- portal service: active, external HTTP 200;
- admin: no separate public service in the existing topology; admin source
  build and guarded API route are healthy;
- Bootstrap signing binding: PASS after catalog repair;
- device/auth/Bootstrap integration gates: PASS in Node 24 PostgreSQL suite;
- beta admission: current source path retained and unit/integration gates PASS;
- Business Bridge: `business-bridge-2.service` active and
  `127.0.0.1:18083` listening; not restarted;
- trust identity: `octoport-preprod-2026-09-19`;
- trust fingerprint: `edc47821df296868c7061069ed50fa742f70a75889bd010dadef5166fadc4645`.

Commercial safety after deployment:

- `SELLER_AGENTS_COMMERCIAL_MODE`: unset, which resolves to `DISABLED`;
- FREE_BETA: active;
- beta device admission: unlimited for commercial-count purposes;
- commercial device-limit enforcement: disabled;
- checkout route: absent from the deployed API (`404`);
- real payment provider: not integrated;
- no payment requirement was introduced.

## B2/M1 smoke

- authenticated own-case and support isolation: covered by deployed-line API
  tests and PostgreSQL integration;
- unauthenticated `/v1/support/cases`: `401`;
- unauthenticated valid-query `/v1/admin/support/funnels`: `401`;
- invalid OTP request input: `400`, with no mail submission;
- B2 migrations and signal tables available;
- M1 funnel route registered and RBAC-guarded;
- no synthetic production funnel or commercial checkout events were added;
- analytics is not a dependency of ordinary Work or delivery.

## SMTP and mail boundary

The deployed worker environment is configured for:

`EmailTransport → SMTP 127.0.0.1:25 → existing Exim`

Safe observed values:

- host `127.0.0.1`;
- port `25`;
- envelope sender `no-reply@octoport.ru`;
- active Resend/SendGrid/Mailgun runtime dependency: none;
- Exim: active, primary hostname `mail.octoport.ru`;
- bounded local SMTP probe: `EHLO`, `MAIL FROM`, and `RCPT TO` accepted;
  `DATA` was not issued;
- STARTTLS: PASS; certificate SAN includes `mail.octoport.ru`, valid through
  `2026-12-20`;
- SPF live: `v=spf1 ip4:78.17.68.165 a mx ~all`;
- DKIM selector `s1-20260921` live in DNS;
- DMARC live: `v=DMARC1; p=none`;
- PTR: still empty;
- outbound TCP/25 from this VPS: blocked or timed out to Gmail, Outlook, and
  Yandex MX hosts;
- Internet delivery: PENDING;
- real owner-mailbox OTP: NOT TESTED and not claimed.

The Exim queue contained three pre-existing entries at verification: one
deferred by remote TCP timeout and two frozen delivery-error messages. No new
Internet-bound test message was generated by this deployment. The inherited
queue was not deleted blindly.

## Package and rollback readiness

The API/auth/Bootstrap contract did not change, so packages were not rebuilt:

- Chromium owner package SHA-256:
  `bfdb6f67b0abb7efd1f7892382e2b1c8c16c07c957e0567d247ef143091f61be`;
- Firefox owner package SHA-256:
  `3db61719560acf27e29591efba3852d0df5e16a9328be813f1198082aee8a459`.

Rollback target is the previous service configuration and runtime path recorded
above. Exact predeploy unit copies are retained under
`/var/backups/seller-agents-owner-test/preprod-r1-20260921T122334Z/`. Application
rollback is ready, but automatic database downgrade is not claimed: the
application must remain compatible with migration `0020`, or the verified
predeploy database dump must be restored under the accepted rollback procedure.

## Remaining external gates

Before owner Q1-C live testing:

1. AdminVPS must unblock outbound TCP/25 for `78.17.68.165`.
2. VPS provider reverse DNS must set `78.17.68.165 → mail.octoport.ru`.
3. Then perform one real owner-mailbox OTP request and verify arrival. No
   console, database, sink, or synthetic delivery is an acceptance substitute.

DKIM and DMARC currently resolve publicly; no further DNS publication was
required during this deployment.

## Final disposition

`PREPROD_CURRENT_LINE_READY_EXCEPT_EXTERNAL_SMTP`

This is a deployment readiness result only. It does not self-accept Q1-C,
S1.2 end-to-end mail delivery, B1 public release, or production cutover.
