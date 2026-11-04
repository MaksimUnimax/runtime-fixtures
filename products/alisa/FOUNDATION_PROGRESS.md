# AL-S00 execution checkpoint · 2026-11-04

Author: Codex execution dialogue. Independent read-only reviewer: assigned separate
gpt-6-luna context. Reviewer found missing migration-config paths in the runbook/doctor.
The paths and doctor checks were added; source review is not stage acceptance.
Initial `alisa` base: `c52ee0937e3301c663d2dd7061c5e2043bf3dc65`.
Before commit, fast-forwarded to the other executor’s disjoint runtime ownership notice
`ee62a43a9c680f2276b8f6907dd2efe577bdcac9`; no runtime source changed here.
Implementation branch: `feat/alisa-platform-foundation-v05`.
Exclusive paths: `products/alisa/`, `.github/workflows/alisa-platform-ci.yml`,
new `docs/alisa/service-platform/v0.5/` publication only.
Runtime/matrix/processor, old applications, OAuth and Business Bridge are excluded.

## ENV-00 facts

- All six A records are 185.244.51.141 / TTL 300. Checked against ns1.adminvps.ru,
  Cloudflare and Google; all four authoritative nameservers also answer stage A/NODATA AAAA.
- New exact-name nginx config `alisa-platform-setup.conf`; old `alice-lab.conf` and
  `default` hashes unchanged. nginx configuration test passed before graceful reload.
- Let's Encrypt certificate `alisa-platform-bootstrap` covers all six names, expires
  2027-02-02. TLS validation without insecure options passed from Alisa and the isolated
  build environment for all six. Roots show host/environment/application_ready=false;
  other HTTPS paths return 404.
- Renewal timer and dedicated lineage-filtered nginx deploy hook are present.
  Both ACME staging renewal simulations failed with remote A/AAAA lookup timeouts.
  Do not count automatic renewal as proven until a successful dry-run is recorded.
- Existing alice-lab.octoport.ru and octoport.ru still returned HTTP 200.
- Host Alisa: 1 CPU, 961 MiB RAM; 408 MiB initially available; disk 8.5 GiB free.
  Existing matrix/lab services are running. No platform application, DB or process was
  installed there. Capacity is **NOT_ADMITTED** for the additional full stack.

ENV-00 remains BLOCKED on an approved adequate stage capacity and private engineer admission.
DNS_READY and current HTTPS_READY do not imply INFRA_READY.

## Implemented source

Two independent Next applications; Django platform API/worker; separate identity shell
with UUID primary key before first auth migration; two migration histories; strict probe
payload and transactionally durable job; one-effect worker; fixed loopback BFF with
separate service identity and exact Origin check; production probe denial; liveness and
real schema/database readiness; disconnected RuntimePort; own locks and generated DTO;
source checks, immutable artifact manifest/offline wheels, own install/activation commands,
private config parsing, isolated DB/role provisioning and systemd/nginx candidates.

Deployment code and PostgreSQL semantics are **not yet qualified on target stage**.
There is no second analytics processor and no live Ozon/WB/LLM/payment call.

## Verification level

Documentation: manifest PASS; validator PASS (25 steps, 70 requirements, 186 scenarios).
SOURCE: 15 focused security/architecture/negative tests passed; both UI type checks and
both production builds passed. UUID route `/__engineering` appears in the Next build.
No success is inferred for unexecuted PostgreSQL, browser, restart or rollback cases.

AL-T00-01: LOCAL_PARTIAL, one source build; second clean checkout pending.
AL-T00-02: SOURCE_PARTIAL, negative import mutation detected; installed isolation pending.
AL-T00-03: INFRA_ONLY, TLS setup markers verified; application routing not installed.
AL-T00-04/05/06/08/09/11: NOT_RUN (real isolated PostgreSQL/restart/recovery required).
AL-T00-07: SOURCE_PARTIAL, actual refused DB connection returns readiness 503/live 200.
AL-T00-10: SOURCE_PARTIAL, missing secret fails; installed artifact/browser scan pending.
AL-T00-12: SOURCE_PARTIAL, CI definition present; remote CI was not run.
  GitHub publication was automatically rejected because explicit permission for external
  architecture publication was judged insufficient. No alternate publishing route was attempted.
AL-T00-13/14: SOURCE_PARTIAL, forged requests and disabled/prod probe rejected locally.
AL-T00-15: SOURCE_PARTIAL, source boundaries checked; installed egress proof pending.
AL-T00-16/17/18: NOT_RUN (retention, target resource measurements and independent handoff).

## Next allowed work

Address independent SOURCE findings; publish exact candidate and safe evidence; complete
temporary PostgreSQL integration and browser/recovery harness. Once sufficient isolated
stage resources and private ingress are admitted, install and reproduce all 18 cases.
AL-S01 stays closed until a real FOUNDATION_READY receipt. No automatic PASS is assigned.


Independent re-review: migration-config defect resolved; no new proven defect found in
those fixes. Limited doctor scope and cleanup timer activation were clarified in README.
This review does not accept SOURCE or FOUNDATION; stage verification remains open.

## Owner-authorized continuation

Owner explicitly authorized GitHub publication. Documentation v0.5 is now published
at 8af2de0818380979b5698e4ae6317b0b45e9a814; all100 files were compared byte-for-byte
with the uploaded package (receipt in tests/acceptance). The earlier auto-review
publication blocker is resolved by that permission. HTTPS Git CLI had no write credential;
publication used the existing connected GitHub authorization without changing credentials.

SOURCE checks now18 PASS (these are source checks, not the18 stage acceptance cases). Added a guarded disposable PostgreSQL qualification and real
packaged browser path to CI. It requires a fresh dedicated alisa_ci_admin cluster,
creates only its own two DBs/roles and a synthetic production-isolation sentinel,
checks migrations/UUID identity/permissions/concurrency/API-worker restarts/DB failures,
BFF/Chromium, TTL with writes disabled and additive schema compatibility. Provision,
API, worker, Node and browser subprocesses receive an allowlisted environment.

Independent reviewer found inherited env on the provision child and a preflight
connection leak; both were fixed. CI execution has not yet been observed. This is
a test harness, not evidence of a passed PostgreSQL or browser run. Real stage
capacity, protected ingress, systemd deploy and actual r1-r2-r1 remain unaccepted.

A second harness review found a DSN hostaddr override that could bypass the
loopback guard. Unknown DSN keys are now rejected before connect, hostaddr is
canonically fixed to127.0.0.1, libpq receives a clean environment, and a populated
cluster is refused before cleanup ownership. Negative regression rejects hostaddr,
service and options without opening a connection.
