# C02 / site ingress recovery — 2026-09-24

Role: C
Status: LIVE RECOVERED / SOURCE FIX PREPARED / NO SERVICE OR DB REDEPLOY

## Incident

The first STORE public-page deployment correctly published `/privacy`, `/support`, and `/install`, but its site-owned nginx template also replaced the already established `app.octoport.ru` and `api.octoport.ru` 443 proxy boundaries with deliberate 503 responses. The portal and API processes themselves remained healthy on loopback.

Observed before recovery:
- `https://octoport.ru/privacy`, `/support`, `/install`: 200;
- `https://app.octoport.ru/login`: 503;
- `https://api.octoport.ru/health/ready`: 503;
- `http://127.0.0.1:3100/login`: 200;
- `http://127.0.0.1:3000/health/live` and `/health/ready`: 200.

The site deploy also omitted `mail.octoport.ru` from the shared HTTP ACME/redirect host list.

## Live recovery

Recovery used the exact previously established app/API proxy destinations (`127.0.0.1:3100` and `127.0.0.1:3000`) while preserving the new apex static-site/page blocks. A root-only pre-change backup was created at `/root/octoport-control/backups/C/ingress-p0-20260924T061523Z/`. `nginx -t` passed and nginx was reloaded; no application service or database was restarted or mutated.

After recovery, ordinary public-DNS/TLS probes returned 200 for:
- `https://octoport.ru/`;
- `https://octoport.ru/privacy`;
- `https://octoport.ru/support`;
- `https://octoport.ru/install`;
- `https://app.octoport.ru/login`;
- `https://api.octoport.ru/health/live`;
- `https://api.octoport.ru/health/ready`.

## Permanent source correction

The authoritative static-site template must own only apex/www HTTPS plus shared HTTP redirect/ACME handling. Existing app/API HTTPS ownership remains in the separately established `/etc/nginx/conf.d/octoport-apps.conf`.

The deploy script now fails closed unless that separate ingress contains the expected app/API host and loopback proxy targets. The verifier requires app login and API live/ready to remain 200 after every site publish. Site Deploy CI asserts the same ownership boundary, and the shared HTTP host list includes `mail.octoport.ru`.

Local verification before commit:
- shell syntax: PASS;
- `git diff --check`: PASS;
- documentation check: PASS;
- Site Deploy contract assertions: PASS;
- live verifier against the recovered state: PASS.

## B auth-path assignment

Controller review also found a separate bounded portal defect: the OTP verify source sends `idempotency-key`, while `apps/portal/app/api/control-plane/[...path]/route.ts` currently forwards only content-type/cookie/x-csrf-token. B owns the portal/API path and must add forwarding of `idempotency-key` with a regression proving the actual proxy boundary. This is not a reason to redesign authentication and C does not edit the active B path.

No owner OTP, credential change, beta opening, live DB migration, or application redeploy was performed here.
