# A03 — Yandex Browser Beta real-browser matrix — 2026-09-23

Status: **REAL VENDOR BETA DEV-ROUTE INSTALLED-SYNTHETIC PASS / STORE RELEASE GATE OPEN**
Role/task: `A / A03`
Exact A product head: `0755f7c75db7f78e0c6d8ae9591665f63e61ee59`

This receipt supersedes the earlier Yandex command-line installation environment defer **only for the official Yandex Browser Beta development route**. It does not claim stable/store installation, LIVE_OWNER, publication, deployment, or production acceptance.

## Vendor artifact and route

Yandex's official Beta documentation publishes the Linux beta repository:
`https://repo.yandex.ru/yandex-browser/deb beta main`.

Yandex extension-security documentation says extension development should use Yandex Browser Beta, where the ordinary unverified-extension check is not applied. The ordinary browser separately trusts catalog-distributed extensions from Chrome Web Store / Opera Add-ons; that store-installed route remains a release gate.

Official repository metadata observed:
- package: `yandex-browser-beta`;
- version: `26.8.1.1101-1`;
- file: `pool/main/y/yandex-browser-beta/yandex-browser-beta_26.8.1.1101-1_amd64.deb`;
- repository SHA-256: `a54c3a603785e86cf487643566521987c1df49827d7296795eb6f2912a365cb2`.

The DEB was downloaded only to the isolated A browser cache and extracted with `dpkg-deb -x`; no system repository or browser package was installed or changed.
Downloaded SHA-256 matched the repository value exactly.
The extracted executable reports `Yandex 26.8.1.1101 beta`.

## Exact product-runtime smoke

Evidence root:
`/root/octoport-control/logs/A/A03_YANDEX_BETA_0755f7c_R1/`

The exact post-A06 product runtime from:
`/root/octoport-control/logs/A/A06_LEGACY_IMPORT_IDENTITY_CORE_R1/package/runtime`
was loaded into a clean real Yandex Beta profile.

Result: **PASS**.
- Seller Agents service worker registered at `chrome-extension://.../service_worker_entry.js`;
- Seller Agents runtime globals were present;
- real popup loaded;
- runtime browser identity: `family=yandex_chromium`;
- runtime UA-derived version: `26.8.0.0`;
- popup showed the expected signed-out state.

The vendor binary reports `26.8.1.1101 beta` while the current packaged identity parser observes `26.8.0.0` from the browser user agent. Both facts are retained; this receipt does not silently equate them.

Resource receipt:
`/root/octoport-control/resource-jobs/59b4f33c1c2a468e879ab519259b0394/receipt.json`
— exit 0, peak 541 MiB, OOM 0, cleanup verified.

## BR-C1 source + extracted matrix

Evidence root:
`/root/octoport-control/logs/A/A03_YANDEX_BETA_C1_0755f7c_R1/`

Machine aggregate:
`aggregate.json`

Final clean aggregate:
- source: **38/38 PASS**;
- extracted package runtime: **38/38 PASS**;
- total scenario executions: **76/76 PASS**;
- provider requests: **0**;
- signed Health requests observed: 105;
- every Health request identifies the runtime as `yandex_chromium`;
- observed runtime version in those requests: `26.8.0.0`.

Clean accepted shard boundaries:
`01-04-r2`, `05-08-r2`, `09-12-r2`, `13-16-r2`,
`17-20-r2`, `21-24-r2`, `25-28-r2`, `29-32-r2`, `33-38-clean`.

An earlier multi-shard wrapper encountered transient `127.0.0.1:43100` collisions before the browser ran. Those rows are environment evidence only and are excluded from the final clean aggregate. The affected ranges were rerun after the port became free.

Resource evidence for the clean rerun:
- `/root/octoport-control/resource-jobs/5e62532d4d5d455fb692466d60bbf883/receipt.json`: exit 0, peak 610271232 bytes, OOM 0, cleanup verified;
- `/root/octoport-control/resource-jobs/5a63d760b4c44eb0962e70a58555dfb1/receipt.json`: exit 0, peak 701497344 bytes, OOM 0, cleanup verified.

## Disposition

Yandex Browser Beta now has its own real-vendor installed-synthetic BR-C1 evidence; no Chromium/Opera result is relabeled as Yandex.

Still open:
- stable/store-installed Yandex route and real N→N+1 update;
- LIVE_OWNER marketplace import and scoped live acceptance;
- external submission/publication.

No real marketplace credentials, provider mutations, production services, or publication actions were used.
