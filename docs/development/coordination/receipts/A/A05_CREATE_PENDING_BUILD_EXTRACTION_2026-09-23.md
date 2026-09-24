# A05 — bounded build cleanup: createPendingWorkStart extraction

Status: **A-SIDE VERIFIED CANDIDATE / READY FOR C INTEGRATION REVIEW**  
Task: `A05`  
Role: `A`

This receipt covers one bounded build-cleanup step only. It does not claim LIVE_OWNER, deployment, production publication, or a broader rewrite of the extension patch system.

## Scope and exact commits

- A05 product/build cleanup commit: `ea5467660a1de7699865ca5214dd3b3e421ef666`.
- Fresh-main merge after the cleanup checkpoint: `e21184c77cea49100408f0ff85c1d02069a86eea`; the A05 diff hash was identical before and after this merge because the incoming main delta did not touch A05 inputs.
- C1 fixture correction required by earlier A02 IndexedDB-vault work: `2a88ced9040da8d1f0b8a086dc75f935f2859150`.
- A02 accepted comparison package: `SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`, SHA-256 `e5fc212b06672eb89fd6c7cf0340e3db6ab840b45e39a4a7f349ad5f4a161231`.

## What changed

`createPendingWorkStart()` had accumulated multiple text substitutions inside `apps/extension/application-patches.json`, including the A01 pending-map/admission changes. A05 moves this one repeatedly edited function onto the already-existing guarded whole-function replacement mechanism:

- `apps/extension/src/background/compat/createPendingWorkStart.js` contains the adapted complete function;
- `apps/extension/composition.json` binds it to donor function SHA-256 `7bbf2b74017852afc3c4af834bea076440bf07c6adbf29e9be69de798bc559b8`;
- the adapted replacement SHA-256 is `f8af51a38db0f31633f9c54a5cdad8945cfa64546945203c2fa0c9ccd318a1ae`;
- exactly two internal legacy text patches were removed;
- the external callsite patch that owns `withBindingWrite(...)` and `admission_provenance` remains unique and unchanged;
- `tests/regression/extension-core/client-i1/create-pending-work-start-extraction.mjs` is the differential/source-SHA oracle;
- `tooling/checks/extension_core.py` runs that oracle before package composition.

No second architecture, new dependency, lockfile change, shared/backend contract change, migration, or provider behavior change was introduced.

## Build/differential evidence

Run root: `/root/octoport-control/logs/A/A05_CREATE_PENDING_EXTRACTION_R1/`  
Node: `v24.20.0`  
pnpm: `10.34.5`

`python3 tooling/checks/extension_core.py` on the A05 cleanup:

- stage `D2.4`: **PASS**;
- gate processes: **114**;
- live provider calls: `0`;
- extraction oracle: **PASS**;
- source/package extension-core gates: **PASS**.

Differential identity against the accepted A02 R2 package:

- ZIP SHA-256 before: `e5fc212b06672eb89fd6c7cf0340e3db6ab840b45e39a4a7f349ad5f4a161231`;
- ZIP SHA-256 after: `e5fc212b06672eb89fd6c7cf0340e3db6ab840b45e39a4a7f349ad5f4a161231`;
- `runtime/service_worker.js` before/after SHA-256: `87bf70f447e32cc5caab074e560b7010cd191b3776bb10b6746f9fa1bdf0dfe3`;
- `runtime/content_script.js` before/after SHA-256: `f3f7a6a8aed745cb4c994a4051e35ba3423d3e8dedc20f270b331a865cd2323d`;
- runtime tree diff: **empty**;
- extracted tree diff: **empty**.

Therefore the cleanup changes composition mechanics only; the produced extension artifact is byte-for-byte unchanged from the accepted A02 package.

## Focused C1 acceptance and fixture correction

The first two focused C1 attempts terminated on `SA_WORK_START` timeout even though the package was byte-identical. A bounded diagnostic run proved this was not A05 product behavior:

- `C1-09`, `C1-11`, `C1-19`, `RB-19`, `PR-09`, and `PR-10` failed with `TRANSFER_VAULT_CLEAR_FAILED`;
- the old C1 fixture called `localReset()` without providing IndexedDB after A02 made transfer-vault cleanup fail closed;
- in gated race cases that exception occurred before `f.release()`, leaving an already-started `SA_WORK_START` promise dangling; Node later surfaced that as the misleading unhandled timeout.

The correction is test-only: `client-c2-3c1-online-work-admission.mjs` now supplies a minimal transaction-complete fake IndexedDB with `get/getAll/put/delete/clear`, matching the existing extension regression fixture pattern. No production code or package bytes changed.

Fresh focused run root: `/root/octoport-control/logs/A/A05_C1_FIXTURE_R1/`  
Exact package SHA-256: `e5fc212b06672eb89fd6c7cf0340e3db6ab840b45e39a4a7f349ad5f4a161231`

Results on both source runtime and extracted runtime:

- C1 cases: **50/50 PASS**, `failureBatch=0`;
- rebind cases: **36/36 PASS**, `rbFailures=0`;
- pre-token cases: **20/20 PASS**, `preTokenFailures=0`;
- source exit: `0`;
- extracted exit: `0`.

## Acceptance boundary

A05 is complete for the planned bounded cleanup criterion: one repeatedly edited function is extracted, source-SHA guards remain authoritative, differential tests prove exact behavior preservation, and the produced package is unchanged byte-for-byte.

This receipt does **not** create a new installed-browser claim. Browser evidence remains owned by A03/A02 receipts for their exact artifacts and environments. C still owns integration into the common line.
