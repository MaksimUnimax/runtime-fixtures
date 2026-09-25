# C02 STORE-1 repaired package authority handoff — 2026-09-25

Status: AUTHORITATIVE PACKAGE INPUT FOR B DISPOSABLE REBIND / NOT LIVE / NOT DEPLOYED

Package runtime source:
- HEAD `e7d66152bdb77918b65115486c9829ef7a634e69`;
- tree `01ae2c1d84a354a11d919a313f8d9909d1285b6a`;
- version `0.2.4`;
- contract `control_plane_v2`;
- canonical migrations: 40 entries through tag0051;
- environment: PREPRODUCTION.

Release authority:
- SHA256 `73ba767c24ed7bd365ccd83b30feb4544dae7a0950602330725ad0b583e8cbd7`.

Opera/Chromium STORE ZIP:
- SHA256 `0c1fb4c9c81c600332dfb6dc2dcfb9c3221dafe9940eab3811112a4e9fc5d71c`;
- bytes 2174363.

Firefox STORE ZIP:
- SHA256 `db3619beef5bc9333c842e42ef80c111bd3e80e6d3f54241702463a56a930f71`;
- bytes 4060997.

B1 candidate manifest:
- SHA256 `6b670838f285f3dbdfd1f471be78a83086c56fae192c83672a2d94179a7b28dd`;
- prepare: PASS;
- preflight: PASS.

Current C integration line through the A03/A04 evidence-only changes has zero package-input delta from `e7d66152...` across extension, control-client, bridge-core, marketplace runtime/reference, extension builders and B1 tooling. Therefore these STORE bytes remain the exact repaired package authority until C reports a package-input change.

B may use these identities to rebind and rerun the disposable ordinary-admin STORE1 activation planner/integration proof. B must not substitute or retain the historical package identity:
- source `891b89f...`;
- Opera ZIP `6914b019...`.

Historical activation evidence remains evidence of the operator path only, not authority for the repaired release.

## Current package evidence

Exact repaired Opera package:
- extracted-package runtime regression: PASS;
- real Opera 136 + disposable API signed RESOLVED-v2: PASS;
- exact-package logged-out popup INSTALLED_SYNTHETIC: PASS;
- popup external requests: 0;
- popup page errors: 0;
- screenshot SHA256 `6e8bfa3d29cf21d3451a075a6aa98266b59efb082760e6ab3f4f0bb5ef49065e`;
- public login page in the same vendor browser: HTTP 200 / PASS.

These are PACKAGE / REAL_BROWSER+DISPOSABLE_API / INSTALLED_SYNTHETIC levels. They are not LIVE_OWNER, DEPLOYMENT, catalog activation or store submission evidence.

No live catalog mutation, DB mutation, deployment or Submit is authorized by this handoff.
