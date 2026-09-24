# Octoport SITE-S1 static deployment

Status: LIVE; site/application ingress separated on 2026-09-24

SITE-S1 publishes the static public site. The 2026-09-24 recovery preserves the deployed portal/API independently; see [the recovery receipt](../../operations/OCTOPORT_SITE_INGRESS_RECOVERY_2026-09-24.md). Repository/CI evidence and live recovery remain separate acceptance levels.

## Runtime boundary

The public site remains a dependency-free static surface from `apps/site/public/`.

Target live path:

`/var/www/octoport-site/current`

Immutable releases are staged under:

`/var/www/octoport-site/releases/<git-sha>`

The `current` symlink is switched atomically only inside the bounded deploy script.

## Ingress boundary

SITE-S1 changes only the public apex behavior after deployment:

- `https://octoport.ru/` -> static public site;
- `https://www.octoport.ru/*` -> permanent redirect to canonical apex;
- `https://app.octoport.ru/` -> existing portal at loopback port 3100;
- `https://api.octoport.ru/` -> existing API at loopback port 3000;
- `admin.octoport.ru` -> remains disabled as an nginx application hostname;
- `docs.selleragents.ru` -> must remain operational and keep its own certificate.

The site deployer owns `octoport-site.conf` only (public-site HTTPS and shared HTTP/ACME redirects, including mail). Existing app/API HTTPS routes live separately in `octoport-apps.conf`. Its repository template records the accepted topology; application ingress is installed by a separately authorized application deployment/recovery, never by the static-site script. An existing separate application config is required before site deployment. Do not run historical site scripts that expect application 503 placeholders.

## Safety design

`infra/production/scripts/deploy-octoport-site.sh` requires:

- root execution on the accepted server;
- clean repository checkout;
- exclusive site-deployment lock and existing separate application ingress;
- static-only nginx source with no application proxy/placeholder blocks;
- expected public IPv4 and DNS resolution;
- accepted Octoport certificate with at least seven days remaining;
- active nginx and certbot timer;
- valid source files and closed-beta copy;
- an existing `current` path only if it is a symlink.

Before changing live state it creates a root-only backup under `/var/backups/octoport-site/<UTC-stamp>/` containing only the previous site/predeploy nginx configs, previous current-release target, and the application-config hash. It never backs up/restores application configs as part of a site transaction.

On any failure after the backup boundary it captures diagnostics and restores the previous site nginx/current state. Application-config changes are detected before installation and before success; rollback preserves the current application config, including independent application maintenance. The deployment uses nginx reload, not restart, and contains no recursive forced cleanup of releases.

## Header/cache invariant

The public-site security headers are defined at the apex `server` level. Static locations use nginx `expires` for cache policy instead of location-level `add_header Cache-Control`; this preserves inherited CSP, X-Frame-Options and X-Content-Type-Options on CSS and other static responses.

The live verifier explicitly checks this inheritance on `styles.css`.

## Acceptance gates before server execution

Repository preparation must pass:

- `Site CI`;
- `Site Deploy CI`, including disposable-filesystem install/rollback and negative route checks;
- Documentation CI;
- architect readback of the final diff against current `main`.

Server execution is a separate action performed only after source acceptance. Successful server execution must run the deploy script and then the verifier again, recording exact checkout SHA, backup path, release target, HTTP/HTTPS matrix, security headers, TLS/SNI result, old docs preservation and nginx state.

The current live verifier requires 200 for all four public pages, portal root/login and API live/ready health with valid response bodies. It also requires the anonymous portal-to-API accounts request to return 401 with `AUTH_SESSION_INVALID`. A 503 placeholder is a deployment failure. These read-only checks do not claim successful email delivery, OTP login or installed-extension acceptance.

Current recovery kept the existing static release `1761e2f92841a2aa3ca8b10e8bee0e3c74e7700e` and all four public page bodies unchanged. The revised deployment script is tested separately in disposable paths; the recovery was a bounded nginx config replacement/reload, not a new application or static-content deployment.
