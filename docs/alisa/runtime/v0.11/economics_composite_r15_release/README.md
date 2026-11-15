# Immutable R15 candidate from the installed release bases

15 November 2026. **BUILDER_SOURCE_TESTED; PRODUCTION_CANDIDATE_NOT_BUILT; NOT_DEPLOYED.**

This finite packaging tool creates three new release trees from the exact installed platform, authority and native trees. It retains the accepted web release and publisher as pinned references. It provides no activation, migration, service restart, configuration change, database connection, credential operation or provider call.

## Observed bases and environment

`baseline_20261115.json` records a read-only readback of the four active/running services, immutable manifests, executable hashes, dependency links and lockfiles. Full hashes are in that file; the relevant releases are:

| Role | Release |
|---|---|
| platform | `/opt/alisa-platform/stage/releases/alisa-customer-catalog-8b8b919993c38128` |
| authority | `/opt/alisa-platform/stage/releases/alisa-parameters-1d572aebf6b05b88` |
| native | `/opt/alice-market/releases/alisa-parameters-1d572aebf6b05b88` |
| preserved web | `/opt/alisa-platform/stage/releases/alisa-public-guidance-e0cc5b5aea966213` |

The running Python executable is `/usr/bin/python3.12` (`e50d468e…`). The real `/usr/local/bin/node` is a regular executable (`904a6d34…`, 126881248 bytes). Platform/authority/web `.venv` links resolve to `/opt/alisa-platform/stage/releases/alisa-store-enrollment-592cc8bb006a4991/.venv`; its `pyvenv.cfg`, Python resolution and declared lockfiles are checked. The environment is reused without package installation. Retain all referenced dependency releases through rollout and rollback.

The preserved publisher is `/usr/local/libexec/alisa/query_gap_publish.py`, SHA256 `dc750adf6818a5cce92d6bccd95b1cfa3e441da6f1406cef41900892b5cdacd2`. No web build is performed. Old R5/S11 installer constants are not reused.

## Exact source and scope

`plan` reads the explicitly supplied final source directory and full source commit. It records the SHA256 of all 96 source inputs and this builder's five tool files. The source commit is provenance supplied by the caller; required source CI and independent review remain external evidence. A plan hash freezes the selected bytes. It does not assert CI, permission or live readiness.

The platform and authority each retain their own complete base. The replacement allowlist is exactly `config/settings.py`, `queries/service.py`, `owner_data/parameter_collection.py` and `owner_data/service.py`. The last replacement accommodates the owner structural-validation performance change; its final source must pass its own review and gates before packaging. Twenty new owner-data modules/catalogues provide R7–R15. Existing authentication, store, catalogue, migration, web and identity files are preserved. A pre-existing supposedly new module causes a refusal.

Fifty-nine preserved dependencies (55 Python files including package initializers, plus four JSON contracts) are compared with final source bytes separately for platform and authority. Native's existing shared parameter support must also match. `parameter_resolution.py` is checked on both retaining platform roles even though R8 copies it to native. Project import closure rejects newly undeclared dependencies, including aliases imported from packages. Every direct output copy must match its pinned source hash.

`compatibility_review.json` records the independently reviewed exact before/after pairs for the four replacements. It also records exactly three preservation exceptions: the later accepted platform `accounts/views.py` and the already accepted `staff/policy.py` in platform and authority. Each exception pins role, path, source SHA and base SHA, with the reviewed rationale. No path-only exemption exists. A changed tuple requires a fresh compatibility review; it never expands the overlay automatically. These exceptions preserve existing login/staff behavior and do not approve a new staff security policy.

The registered full economics path currently supports **WEB admission only**. `remember()` returns an empty object for non-WEB channels; the existing voice continuation branch stays unchanged. Both new feature flags remain off until a separately reviewed activation.

Native starts from the actual R5 release, validates its whole manifest and coherent `CURRENT_CORE_MANIFEST.json`, then applies the existing source prepares R8 → R11/R13 leaf copies → R14 → R15. The nine R8 `BASELINE.json` hashes were independently compared with the actual installed bytes. The whole-manifest check additionally covers `repository.py`, read-surface data, unchanged protocol and every other file. This builder never imports or extracts `native_fixture/qualified_core_source.tar.gz`.

All existing template definitions and catalogue metadata must remain equal; only `economics.delivery_projection.v1` and `economics.unit_forecast.v1` may be added. New source/support files are explicit. Generated core and release manifests contain every output hash. Historical base acceptance is retained under `base_provenance`; candidate acceptance starts as `CANDIDATE_BUILT_NOT_INSTALLED`.

## Commands and output

These are the commands for a later authorized build on the recorded environment. None was executed on production while authoring this tool. Substitute a verified final source directory and its full commit; source/plan/output directories must be canonical and separate from release inputs.

```bash
python3 -B build_candidate.py plan \
  --source-root /path/to/verified-final-source \
  --source-commit FULL_FINAL_SOURCE_COMMIT > /path/to/new-PLAN.json

sha256sum /path/to/new-PLAN.json

python3 -B build_candidate.py build \
  --source-root /path/to/verified-final-source \
  --plan /path/to/new-PLAN.json \
  --plan-sha256 EXACT_PLAN_SHA256 \
  --output /var/tmp/alisa-economics-r15-candidate-FINAL_SOURCE

python3 -B build_candidate.py verify \
  --output /var/tmp/alisa-economics-r15-candidate-FINAL_SOURCE \
  --prepared-sha256 EXACT_PREPARED_SHA256_FROM_BUILD
```

`plan` and `verify` are read-only. They verify source-only release files and read safe service metadata (`WorkingDirectory`, `MainPID`, `ActiveState`, `SubState`, process cwd), two current symlink targets, publisher and executable hashes. They do not read systemd `Environment`, credentials or database contents. `build` writes only a new private staging directory and atomically publishes the requested new directory with Linux `RENAME_NOREPLACE`; an existing destination, including a concurrent empty directory, is preserved. `/opt` output is refused by the source prepare contract. A later reviewed installer owns copying the immutable release folders to the proposed `/opt/.../releases/<artifact_id>` paths.

The bundle contains `releases/platform`, `releases/authority`, `releases/native`, `PLAN.json` and `PREPARED.json`. Files are independent copies, never writable hardlinks to a base. Internal links are checked for escape; `.venv` is the one explicit external dependency. New files are fsynced and made read-only. Failure cleanup touches only this invocation's private staging inode. It never restores a changed input or removes another writer's final directory.

The final pre-publication CAS rechecks all source inputs, whole base manifests/files/links, actual live references, environment and publisher. `verify` checks the externally pinned receipt, candidate inventory/core manifests, unchanged files, expected external links and current bases again. This describes observed consistency; a later installer must perform its own fresh CAS under `/run/lock/alisa-stage-rollout.lock`.

The space check retains the previous release policy's 3 GiB free-byte and 200000 free-inode reserve, after a conservative full-copy/block/directory budget. A 15 November readback measured 249721698 bytes in the three bases, 677824 bytes in the source inputs, and approximately 301 MiB of required build space including overhead. `/var/tmp` then had 3228270592 bytes free, which is insufficient to retain that reserve. Do not build there in this observed state. A different canonical output filesystem must satisfy the budget and the active resource policy; tmpfs additionally requires an explicit available-memory budget. No historical or other writer's files may be cleaned to manufacture room. Durable publication/install still needs adequate persistent storage.

## Native import probe and later configuration

The reviewed import probe runs through the pinned real Python using `-I -B`, an empty service environment and explicit candidate `sys.path`. An audit hook rejects writes, database access, network and child-process creation during imports. It does not instantiate `RuntimePort`, whose constructor creates tables. The hook is an additional guard for reviewed imports, not a sandbox for arbitrary hostile extension code.

The probe obtains `runtime_port.current_versions()`, validates the catalogue, and records read-surface, parameter-source, parameter-report and full-economics PINs. All version fields except `catalog_bundle_hash` must remain equal, and the read-surface PIN must remain equal. Full manifests remain essential: `catalog_bundle_hash` alone does not cover the `parameter_support` subtree.

R8 changes `parameter_source_runtime.py`, so **the later configuration must update the existing `parameter_sources` PIN as well as add `parameter_compounds` and `economics_composites` PINs**. Values are taken from this exact candidate receipt, never from the earlier test fixture. Platform flags are `ALISA_OWNER_PARAMETER_COMPOUNDS_ENABLED` and `ALISA_OWNER_ECONOMICS_COMPOSITES_ENABLED`. This builder changes none of them.

`rollback_allowed` is a pure comparison of the four component fingerprints and preserved publisher. It accepts only the recorded previous state or this candidate and refuses a later writer. Proposed candidate paths are metadata. Restoring actual systemd overlays, feature flags, native version pins and owner-pair projection remains the responsibility of the future reviewed activator; no rollback operation exists here.

## Verification and outstanding gates

Use the locked platform test interpreter prepared by the existing source CI bootstrap. A plain standard-library virtualenv cannot run the native import probe, which requires the existing cryptography dependency:

```bash
PYTHONDONTWRITEBYTECODE=1 products/alisa/.venv/bin/python -m unittest discover \
  -s docs/alisa/runtime/v0.11/economics_composite_r15_release/tests -p 'test_*.py'
```

The source gate exercises filesystem publication/failures, dependency compatibility and the real source prepare/import chain on a reproduced R5 test input. Fake service/environment inputs exist only inside test mocks. These tests do not qualify a production package. The final author result and review scope are recorded in the implementation document.

Before a live switch: finish exact final source CI/review, generate/review this exact build plan, build and verify the real package, qualify it in the existing isolated harness, resolve the owner compatibility and browser handoff gates, then implement/review activation with admission/drain and rollback. `BUILT_NOT_ACTIVATED` never claims installed synthetic acceptance or a real owner result. See the implementation document for the bounded owner metadata preflight and remaining scope.
