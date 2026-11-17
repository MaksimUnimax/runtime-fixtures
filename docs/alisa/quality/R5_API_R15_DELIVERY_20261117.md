# R5 prepared-period binding over accepted R15 — 17 November 2026

The cabinet API previously resolved a period again at start. Product PR459 (`3f2527482db8fd7edb240258fae814d38adc0f4f`) signs the prepared period and verifies its owner/store/request/security revisions before admitting the exact period. Product Source 43852867711 and Documentation 43852867615 passed. Artifact14220296522 ZIP SHA256 `21faeeba76750c6a184eb2382dbf6279c811818b2523f20099e5e3766a14d27e`, platform TAR SHA256 `6950fc60b22fd574991342c13a9803b145faa4b5f9cf60f915f7e6255c447927`, retained and verified on Alisa.

## Correct service and accepted base

PR461 targeted the Unix runtime authority rather than the HTTP cabinet API; it remains blocked and must not be applied. This independent delivery scope targets `alisa-platform@stage.service` on HTTP18102. Its working directory is the R15 release root, and `infra/launch.py platform` derives the health release from `manifest.artifact_id`. The new API health must name the new candidate; its generated ALISA_RELEASE and PYTHONPATH must exactly match the effective pinned release before they are normalized in stable environment comparison. All other environment values/configuration remain pinned.

Accepted API base `alisa-economics-r15-platform-cafb743c94672104`, manifest `39af4f38c9042217ebb035807ee05a3351151aa0caf6428b6de4b33bdb480c39`. The candidate `alisa-r5-bound-api-r15-3f2527482db8fd7e` has expected manifest `fa4f9b85ebcb211e4f36a3d4dfe477f4c05af9aec2ed96d9f5a558ac73e1be53`.

Only parameter_service.py, parameter_collection.py and parameter_periods.py are overlaid from the qualified package. Every other accepted R15 file, including queries.submit/parameter_report_rpc.remember, additive schema metadata, contracts and the exact external virtual-environment link is retained. Models, job client, period producer/catalog contracts and locks are compatible. The native R15 release and runtime authority are pinned and preserved. No migrations or credential/access changes are part of this delivery.

The separate web step overlays the qualified web build on `alisa-r5-preview-5e5e8cc8922342ca`. It requires the exact installed API candidate manifest and preserves the actual R15 authority command. Both finite installers retain reviewed private preparation ownership, no-replace/CAS publication, configuration inventories, common rollout flock, zero active-job preflight, protected service PIDs and conditional rollback controls. Old scripts/plans cannot authorize these new candidates.

## Evidence and remaining checks

73 installer boundaries (one actual-systemd case requires root) pass locally, including actual health response parsing and rejection of the previous API release label. The exact installed-source R15 hybrid passed all35tests and another7withcompounds enabled, zero external attempts. The complete catalog test entry point also passes190checks; independent review is in progress; source, package, installed synthetic and live owner evidence remain separate. No new release has been selected at this checkpoint. A prior installer revision prepared an unselected candidate; its source and evidence will be retained while rebuilding under the reviewed final installer.

Next: finish exact hybrid qualification and independent review; publish the concrete installer revision, pass its CI, prepare and apply API then web, and verify the live preparation/UI. Owner acceptance must confirm that a prepared period is retained and changing the form during preparation prevents dispatch. Do not resubmit UNKNOWN commands or overwrite existing business values to test.

Authoritative automatic available-history discovery remains OPEN. Signed preparation does not establish the earliest available marketplace date.

## Actual systemd inheritance correction

The first finite API apply of fc8cae8d stopped at LOADED_CONFIG_CHANGED before starting the new process. Conditional rollback restored the accepted R15 API and preserved all eight other services. The cause was repeating the accepted drop-in's EnvironmentFile in the new drop-in: systemd retained the duplicate in its effective EnvironmentFiles list. No candidate was admitted for new work.

The corrected override contains only [Service], WorkingDirectory and the reset/replacement ExecStart entries. Environment and environment files are inherited from the accepted configuration. An actual systemd fixture reproduces the old failure (only EnvironmentFiles differs), proves the execution-only override exactly matches expected_static, and verifies its random disposable unit is never started. It holds the common rollout lock, uses only synthetic flags and /bin/true, and removes its own fixture. The complete root test entry point passes190; the scoped nobody suite passes73 with the root-only systemd case skipped. All earlier source/package/hybrid evidence remains distinct. The rolled-back attempt and unselected release are retained privately; a new exact revision and plan are required before another apply.

## Web module namespace correction

The corrected API is installed: manifest fa4f9b85ebcb211e4f36a3d4dfe477f4c05af9aec2ed96d9f5a558ac73e1be53, readiness names the new API release, all eight other roles unchanged, no migrations or provider calls. Source44002613363 and Docs44002613280 passed for the API installer correction.

Web preparation then exposed a copied namespace reference: candidate_identity called w.secure although the web module defines secure locally. Preparation failed before selecting a web release; finite recovery retained its proof and removed only owned staging. The one-line fix binds to the web module's actual helper. A new regression executes the actual candidate_identity function with the declared web globals and no artificial w alias; the structural comparison separately preserves the shared checks with the appropriate namespace. The complete root entry point passes191, and the scoped nobody suite runs74 with the actual-systemd root case skipped. Web source and its new plan remain to be qualified before selection; the installed API stays in place.
