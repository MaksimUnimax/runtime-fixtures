# AL-S02 provider candidate experiment

This is a disposable protocol experiment for `django-allauth[idp-oidc,mfa]==65.21.1` with the existing UUID `Person` and Django 5.2.19. It is not the application login, a cabinet, an installed package, or AL-S02 acceptance. Runtime identity settings and dependency locks remain unchanged.

`requirements.lock` pins every experiment dependency and hash. The explicit requests dependency is necessary because this allauth version imports its CIMD module even when CIMD is disabled. Dynamic registration and CIMD remain disabled.

## What is exercised

The candidate's actual Django HTTP views and PostgreSQL migrations handle email-code login, rejected codes, browser binding, logout/replay, expiry, maximum attempts, duplicate-free repeat login, OIDC Code + PKCE, consent, audience/issuer/signature/expiry verification with PyJWT, two clients, key rotation and the library's TOTP factor/replay handling. Mail stays in memory, using example.invalid. No external HTTP service receives authentication/protocol requests; the runner downloads locked packages and the container image.

The baseline measures the unmodified candidate. A missing policy is recorded as a failed required-policy observation and `REQUIRES_POLICY_ADAPTERS`; it is never reported as an accepted login. The second mode adds prototype integration policies:

- one canonical host and a fixed issuer via the public OIDC adapter;
- S256 required at the authorization boundary, including the POST-to-GET path;
- a shared Django DatabaseCache plus a PostgreSQL transaction advisory lock around the library's code exchange, with two-process redemption checked explicitly;
- valid signed consent POST continues through the library.

The library generates/verifies codes, PKCE and signatures. The prototype does not implement a replacement cryptographic protocol. Policy code remains in this experiment until the full product integration is reviewed and qualified.

## Execution boundaries

`run_isolated.py` accepts only a root-owned `/var/lib/alisa-platform/testing/s02-provider-<12hex>` directory with the exact marker and input hashes. It initializes a separate PostgreSQL 16 data directory as postgres, uses a private Unix socket, creates only `alisa_s02_probe`, stops the cluster, and removes its own data/cache/venv. It refuses an existing result or data directory. Staging inputs is an explicit preparation step; this entrypoint never reads `/etc/alisa-platform`, production DSNs or auth credentials.

`run_ci.py` runs only as root in an ephemeral GitHub Actions runner. Its own PostgreSQL 16.15 container is pinned by its Docker Hub manifest digest as well as version; it has `--network none`, no published TCP ports, limited CPU/memory, a private socket mount, and no live credentials. Effective network mode, host bindings and image digest are read back. Baseline and hardened modes receive separate empty logical databases inside that same disposable container. Cleanup targets only its returned container ID and owned paths. The workflow disables checkout credential persistence and uploads only the three safe JSON reports, excluding messages, tokens, keys and private diagnostics.

`run_probe.py` checks the owned socket marker and actual `current_database()` / Unix-socket address before running migrations. Neither runner accesses a live stage database, changes an installed release, or starts another development executor.

## Limits

Even a passing hardened result is provider-core qualification only. It does not prove a real TLS browser deployment, a BFF with one-use state/nonce, a product session or cabinet, tenant/data separation, browser MFA enrollment, RP-initiated logout policy, service restart behavior or real controlled email delivery. These remain part of AL-S02. Live identity, DB/security/client/key changes require the next exact rollout plan and owner approval.

The three initial server attempts remain historical evidence: missing requests import; a wrong assumed six-character email-code parser; and an anonymous browser without a CSRF cookie causing a misleading response-status failure. The updated probe creates a valid anonymous CSRF context without issuing a login stage, and tests consumed-code replay only after actual logout. Historical FAILED reports are retained.
