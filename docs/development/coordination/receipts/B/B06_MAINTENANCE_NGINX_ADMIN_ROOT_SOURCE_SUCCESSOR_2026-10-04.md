# B06 maintenance nginx admin-root source successor — 2026-10-04

Status: **SOURCE CANDIDATE** on exact base `7872fc2d51f6b3e8178fe48bb445f47c31204656`.

## Purpose

Align canonical nginx source with the independently reviewed and already-applied owner-test routing fix. The installed environment proved that exact `/admin` must proxy directly to the admin app on loopback port 3101; redirecting it to `/admin/` created a redirect loop with the admin application.

This task does not change live nginx, authentication, maintenance grants, database state, provider state, browser state or production credentials.

## Accepted operational evidence

- Installed maintenance source: `fa67708525b8209ae2129e443bc6c44b4046a5fe`.
- Installation receipt: `/root/octoport-control/logs/controller/maintenance-access-20261004/installed/receipt.json`.
- Routing diagnosis: `/root/octoport-control/logs/controller/maintenance-access-20261004/NGINX_ADMIN_ROOT_DIAGNOSIS.json`.
- Independent routing review: `/root/octoport-control/logs/controller/maintenance-access-20261004/NGINX_ADMIN_ROOT_REVIEW.json` — PASS.
- Applied live routing receipt: `/root/octoport-control/logs/controller/maintenance-access-20261004/NGINX_ADMIN_ROOT_APPLIED.json`.
- Reviewed operational patch SHA256: `1704d35a2da3928790ea1963e97a21e7f5fa13ae8299f567b999127187320595`.
- Reviewed fixed nginx file SHA256: `2eee532bd5317960219c406f4f4bcf9d7978ea80e3432ee86584e5c6fb32b4e4`.

The candidate `infra/production/nginx/octoport-apps.conf` SHA256 is exactly `2eee532bd5317960219c406f4f4bcf9d7978ea80e3432ee86584e5c6fb32b4e4`, byte-matching the independently reviewed applied configuration.

## Source change

Only the exact-root block changes:

- `location = /admin` no longer returns `308 /admin/`;
- it proxies to `http://127.0.0.1:3101`;
- it carries the same HTTP version and forwarding headers already used by `location ^~ /admin/`.

The existing `/admin/` block, portal root, API virtual host, TLS settings and security headers remain unchanged.

A narrow source regression test was added at `tooling/server/test_nginx_admin_root_config.py`. It verifies:

1. exact `/admin` proxies to port 3101 and cannot contain the old 308 redirect;
2. required forwarding headers remain present;
3. `/admin/` stays on the same admin upstream;
4. both admin location declarations remain unique.

## Focused validation

- `python3 tooling/server/test_nginx_admin_root_config.py` — PASS, 3/3.
- `python3 -m py_compile tooling/server/test_nginx_admin_root_config.py` — PASS.
- `git diff --check` — PASS.

Independent exact-candidate review and governed publication remain separate required gates.
