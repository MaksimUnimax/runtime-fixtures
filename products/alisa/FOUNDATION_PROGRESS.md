# AL-S00 execution checkpoint · 2026-11-04

Status: IN_PROGRESS / NOT_ACCEPTED. Draft PR:
https://github.com/MaksimUnimax/runtime-fixtures/pull/383.

Own paths: products/alisa, its CI workflow and service-platform execution documentation.
Matrix, marketplace processor, existing applications/OAuth and Business Bridge are excluded.
No marketplace, LLM, payment or real customer operation is performed by this work.

## Observed target results

- Owner upgraded 185.244.51.141 to 4 CPU / 8192 MB / 15 GB NVMe. OS: 4 CPU,
  7941 MiB RAM. Old 1 CPU/961 MiB observations are historical.
- PostgreSQL16.15 installed; independent alisa_stage_platform/alisa_stage_identity DBs,
  migration/runtime roles, private configs and five separate stage service users created.
- r1 source3e763ad761fac377e391e2181f972d9795b7646a, package SHA256
  9967d4f655632b36489148cfabb99de2235613c97391ba2925be6d3c7bbe601c.
- r2 source29c99f6d9d00f19e14087a85d488a6cf5264ff1b, package SHA256
  f8c042561abc0cfd00007a2f61deaadd7de285583b7fd83f812dc7adb3ee37fc.
  Both exact immutable CI packages were installed offline; no target UI build.
- r2 CI:32 Python,6 Node assertions,39 actual PostgreSQL/browser cases passed.
  Push41828542002 and PR41828551580 are separate clean CI jobs. General repository
  Documentation CI remains red for old navigation/checker errors; PR stays Draft.
- Real TLS browser→BFF→API→PostgreSQL→worker completed. Same UUID/correlation/effect1
  survived restart of all five new services and r1→r2→r1→r2. Compatible index migration
  applied/repeated; no database restore. Target final version is r2.
- Controlled UID-scoped egress test blocked old API/external destinations while the
  browser roundtrip passed; deny counter unchanged during the probe; test table removed.
- Stable 16.768s smoke:60 samples/20 synthetic posts; six app+PG cgroups peaked together
  at319291392 bytes (~305MiB), no new OOM; ~6.5GiB MemAvailable/~6.7GiB disk free.
  Excludes OS/nginx/existing services/browser observer; not a capacity benchmark.
- Existing alice-lab and Octoport roots stayed200; protected old nginx hashes unchanged.
  Production names still serve setup markers, not applications.

Full author evidence (foundation_ready=false):
https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/service-platform/execution/AL_S00_STAGE_2026-11-04.json
Published at5200a658ae1460c69d66485e348692d74393d97d.

## Corrections and remaining work

Independent read-only source review found release preflight/rollback namespace/integrity
problems; fixed and re-reviewed. r1 worker exited on transient DB timeouts; r2 retries
with bounded backoff and safe down/recovered events. Disposable real NOLOGIN recovery
proved the job survives and is processed once. No driver credentials are logged.

The initial resource sampler missed a frame during deliberate restart and remains
FAIL_RESOURCE_MEASUREMENT; a separate stable measurement passed. Initial nft syntax
failed in --check before any mutation; corrected isolated test passed. No failure was
relabelled as success.

Independent target acceptance is running. Remaining trace/TTL/probe-shutdown/handoff
facts belong to the actual 18-case receipt. Prepared BFF correlation logging emits
only validated UUIDs; it requires its own review/CI before target installation.

Current six-name certificate is valid until2027-02-02. Renewal dry-run at12:23:54 UTC
failed externally with ACME staging rateLimited/Service busy. No immediate retries.
This does not invalidate the current certificate or prove future renewal.

Documentation v0.5 remains100 byte-verified files at8af2de0818380979b5698e4ae6317b0b45e9a814.
AL-S01 remains closed until a complete independent FOUNDATION_READY receipt.
