# A — STORE 0.2.10 redundant verifier removal

Date: 2026-09-30
Task: `A_STORE_SUCCESSOR_0210_UNUSED_VERIFIER`
Handoff: `/root/octoport-control/peer-handoffs/A/C-A-OPERA-UNUSED-VERIFIER-0210-20260930T1140Z.request.json`
Base A HEAD: `a46c1570c353a35e737722adb9977d75d0e97f90`
Base `origin/main`: `ce66837f59ea1fa186dbcf582efb1edabc33a531`

## Change

- Bump composed successor version from `0.2.9` to `0.2.10`.
- Add `store_excluded_application_files` with exactly `shared/bootstrap_verifier.js`.
- `tooling/build/extension_composed.py` validates that store-only exclusions are unique declared application files and omits them only in `mode=store`.
- Development mode continues packaging `shared/bootstrap_verifier.js` unchanged for verifier tests.
- Store regression proves the standalone verifier is absent while `packages/control-client/src/crypto.js` remains embedded byte-for-byte exactly once in `service_worker.js`.
- Store regression also checks every exact local resource declared by the generated manifest exists in both runtime and extracted ZIP.

## Verification

Command (through the A heavy slot):

`python3 tooling/coordination/control.py A heavy --profile build --memory-mib 1200 --timeout-seconds 240 -- python3 tests/regression/extension-core/store-package-contract.py`

Result: PASS. Checks reported:

- development verifier retained;
- store standalone verifier absent;
- worker verifier embedded exactly once;
- all declared resources present;
- store HTTPS/v2 config;
- Octoport icons;
- deterministic Chromium ZIP;
- Firefox store derivative;
- invalid HTTP/PRODUCTION/duplicate trust authorities rejected.

Resource job: `octoport-test-a-ed30aea247854be59de40871ea8f8acd.service`; exit 0; peak 41 MiB; cleanup verified.

Static checks: `python3 -m json.tool`, `python3 -m py_compile`, `git diff --check` — PASS.

## Frozen 0.2.9 preservation

No frozen artifact was rebuilt or modified.

- Chromium 0.2.9 SHA-256: `f409e35fb714139cc5eefd6c3b390d5d2ca89fb9567a58cb3b68157e1f62eeae`
- Firefox 0.2.9 SHA-256: `be2d603f34c43c5c95aa4e7e83b5c842d39b5ac7590ebb49464fec46f2396542`

The exact 0.2.9 installed-acceptance tests intentionally retain their pinned `0.2.9` identity.

## Boundary

This is an A SOURCE/package-contract candidate only. It is not a frozen 0.2.10 release, store upload, reviewer approval, live deployment, or proof of the separately closed `work-resume`/`quota resume` line. C remains the release integrator/freeze owner.
