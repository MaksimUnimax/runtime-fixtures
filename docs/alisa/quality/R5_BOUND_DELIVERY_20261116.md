# R5 bound preparation delivery — 16 November 2026

The old backend resolved the period independently during preparation and start. PR459 / `3f2527482db8fd7edb240258fae814d38adc0f4f` binds start to the prepared, signed period and the current owner/store/security/catalog revisions. Its Source CI 43852867711 and Documentation CI 43852867615 passed.

## Qualified package

GitHub artifact 14220296522, 52,365,761 bytes, ZIP SHA256 `21faeeba76750c6a184eb2382dbf6279c811818b2523f20099e5e3766a14d27e`.
Platform TAR SHA256 `6950fc60b22fd574991342c13a9803b145faa4b5f9cf60f915f7e6255c447927`.
Runtime TAR SHA256 `1e476148f3ea212d0e3f0fb27600209d9f1ed827b637abfb411a5fccda766a0f`.
Both manifests attest the exact source; ZIP CRC and TAR sidecars passed on Alisa. Receipt and package stay in the private install directory. The signed download URL is not retained.

## Scope and compatibility

First install the authority overlay, then the compatible web overlay. The authority changes only `parameter_service.py`, `parameter_collection.py`, and the new `parameter_periods.py` from the qualified package. All other pinned live R5 files, migration history, locks, contracts and virtual environment are retained. The package contains two later customer-login auth-contract versions and five unrelated account/catalog/staff changes; exact known versions are checked and those files are retained from the accepted authority base. Any additional platform file, migration, model, dependency or contract drift is rejected. The initial blanket contract-equality preflight correctly blocked before candidate creation; this explicit overlay qualification replaces that unsuitable full-package assumption. Expected authority manifest: `a799633b5defcc6a0a59f4eebe4c35a82b55672ed7c5f40a8d90d375a3727d16`.

Only the authority service restarts in the first step. Its existing highest drop-in is retained; a later, exclusively created drop-in changes its three source-root references in WorkingDirectory/ExecStart. Environment and environment files retain their values. The health release label is legacy metadata and is preserved; the effective source is proved separately through the exact service command, directory, manifest and new API response. No migration, native runtime, owner value, credential, access grant or feature flag changes.

The web step keeps the accepted web switch/rollback controls and adds an exact authority command hash check, with the new package, prior live web base and exact installed authority pin. It restarts only the web service. Both steps hold the common rollout flock, recheck zero active jobs, preserve the other eight service PIDs/configuration, retain prior releases and refuse concurrent configuration/selector changes.

## Qualification status

Author tests cover 130 boundaries under root and nobody. Independent review is in progress. Partial materialization now happens inside a private envelope whose device/inode is recorded before copying; only a validated candidate is published. Failure cleanup and the finite recover-preparation command remove only proven owned staging and preserve foreign identities. Proof and plan publication now use exclusive staged records and no-replace/CAS identities; recovery recognizes its fixed detached form and rollback refuses intervening service-state changes. Plan writing is last; failed own plan evidence is retained under a distinct name. The previously prepared, unselected V3 candidate will be archived and prepared again with the exact reviewed installer; its old plan cannot be applied by this revision. No new source has been installed. Live owner acceptance is not run for this candidate. No marketplace/model calls were submitted for delivery preparation.

Automatic available-history discovery remains OPEN: there is still no qualified source-attested lower-bound metadata producer. Signed preparation fixes consistency and does not claim to discover that bound.

## Next and manual acceptance

Complete fault-boundary tests, independent review and exact installer CI before switching. Then verify actual source/health, prepared-reference API and the UI, without submitting duplicate or UNKNOWN jobs. Manual acceptance should confirm that changing the form during preparation never starts a calculation and that the admitted result retains its prepared period.
