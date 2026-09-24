# Public site and application ingress recovery — 2026-09-24

Owner authorized the controller to repair the live routes immediately in a separate worktree without assigning implementation to A/B/C or interfering with their active candidates. Base: `866a99562f3e21cf259e065d6c504ac938247963`. Controller branch: `controller/site-ingress-repair-20260924`. Normal C-only integration rules remain in force.

## Cause and exact boundary

The site deployment at 04:51 UTC replaced the combined nginx file with a historical template containing intentional app/API 503 placeholders. Both source verification and CI considered those placeholders correct. The API and portal processes themselves remained healthy on loopback. This was an ingress/publication regression, not lack of memory or a reason to reinstall the server.

The recovery restored the exact accepted app/API proxy blocks from `/var/backups/octoport-site/20260924T045103Z/octoport-site.conf`, placing them in separate `/etc/nginx/conf.d/octoport-apps.conf`. The static-site file retains the current four public pages, security headers/cache policy, HTTP redirects and mail ACME hostname. Config test and reload succeeded at 05:48 UTC. No application restart, source deployment, DB change, secret read, OTP request or cleanup was performed.

## Live evidence

Server receipt: `/root/octoport-control/incidents/site-ingress-repair-20260924/live-repair-receipt.json`; full verifier: `verify-live.log` in the same directory. Previous broken bytes are retained as `before-octoport-site.conf` for forensic/rollback evidence.

| Route | Before | After |
| --- | --- | --- |
| Apex, /privacy, /support, /install | 200 | 200, all four SHA-256 bodies unchanged |
| app.octoport.ru root and /login | 503 | 200 |
| api.octoport.ru /health/live and /health/ready | 503 | 200, expected JSON health status |
| app.octoport.ru /api/control-plane/v1/accounts, anonymous | Not checked | 401, AUTH_SESSION_INVALID |

Current static release remains `1761e2f92841a2aa3ca8b10e8bee0e3c74e7700e`. Live config hashes: site `a3de42ea088f1d4ae1652d8150f9ff971ba7b2c21f7544e530d97069997f4748`; applications `2675ab2704977645c03cfd758e92c97429ecfd112ef3af1bb2d89f40d4738bdc`. Full live verifier also checks TLS/SNI, public content/security/cache, redirects, old docs service and disabled public admin hostname.

## Prevention and validation

- Static publication requires separate application ingress and a single site-deployment lock; it refuses historical combined templates.
- The site installer changes only its own nginx file/release pointer. Backup/rollback never overwrites independent application configuration.
- Application config hash is checked before install and before success.
- Publication verifies working portal/API and anonymous authorization denial; 503 or a fake 200 health response fails.
- Eleven standard-library regression tests exercise the actual Bash functions in disposable directories: successful install, missing/changed app config, rollback preserving application edits, real EXIT-trap rollback, historical bad template and negative service/auth responses. No new runtime dependency/service was added.
- Bash syntax, both existing Site CI jobs, Site Deploy CI contract and documentation consistency are checked against this candidate. GitHub CI/publication of the exact integrated revision remains C's normal gate; local tests must not be represented as GitHub acceptance.

## Remaining boundaries

The separate portal OTP proxy finding remains open: the proxy drops the idempotency-key header. This recovery does not change B-owned authentication code and does not claim end-to-end OTP or reviewer login acceptance. Design work on the public static site can proceed; account functionality/store reviewer acceptance still requires its existing checks.

Resources during repair: 16 GB nominal RAM, approximately 12.5 GiB available, about 24 GiB free disk. A new B test-group memory-limit OOM at 05:58 UTC was isolated to its cgroup, not a host-wide OOM. The stream should inspect the group workload/limit; this observation does not justify more host RAM or stopping useful concurrency. No files or processes were removed.

Store status is not advanced to submitted/published by this repair. Public support/privacy/install pages and app/API reachability are available; exact package installed acceptance and a working reviewer login remain required. Safari remains outside beta.
