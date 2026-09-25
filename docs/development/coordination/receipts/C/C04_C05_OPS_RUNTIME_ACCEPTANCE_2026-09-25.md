# C04/C05 ops runtime source acceptance — 2026-09-25

Status: **CANDIDATE / SOURCE + IMMUTABLE PACKAGE EVIDENCE / NOT LIVE / NOT DEPLOYED**

Accepted base before this block:
`a844c1230edbd32a5a9ec4d7773d5eaa806b8991`.

Ops runtime source:
- checkpoint `5fc7b2d2b7e33054f6ba3cf664cb35f26397f5ef` was explicitly NOT_ACCEPTED;
- corrected runtime/source SHA `69db39e795010d0f9acfc9ffcaef76b38f5f59b3`;
- corrected runtime/source tree `6305395fc0dcf07dec5c3ffa6db2d4b59692b8f3`.

Scope:
- fail-closed Telegram operator configuration while preserving existing multi-destination notification behavior;
- immutable production ops release preparation and integrity verification;
- non-root Telegram service template/installer preparation;
- independent PostgreSQL backup runtime, verifier, retention, service/timer and installer preflight;
- runtime TypeScript dependency closure required by API-watch product-registry parsing;
- production operations documentation.

No DB/migration schema, marketplace payload, live service, live database, payment, store, browser session or provider mutation is in this block.

## Independent review

First Luna read-only review: `NEEDS_CHANGES`.

Findings:
- High: historical backup retention could count a self-claimed archive without revalidating restore listing;
- Medium: Telegram config accidentally narrowed multiple notification destinations to one;
- Medium: backup service/timer lacked bounded install/preflight;
- Medium: Telegram installer did not prove service-user runtime accessibility;
- Low: pgpass setup failure could leave an incomplete staging directory.

Parent corrected all findings and added negative regressions.

During immutable release rehearsal on checkpoint `5fc7b2d2...`, parent found an additional real deployment defect: root-only pnpm package files allowed the root build gate to pass but made non-root `tsx` fail on `esbuild` with `ERR_MODULE_NOT_FOUND`.

Correction:
- release builder normalizes the immutable payload to root-owned, non-writable, non-root-readable/traversable permissions;
- release verifier rejects root-only regular files and untraversable directories;
- installer retains non-root service identity and does not weaken `ProtectHome`.

Second Luna read-only review on the corrected state:
- verdict: `READY_FOR_EXACT_RELEASE_REHEARSAL`;
- High: none;
- Medium: none;
- Low: none;
- all six reviewed findings marked RESOLVED.

## Source and safety validation

Pinned project environment: Node 24.20.0 / pnpm 10.34.5.

Final focused job before exact release rehearsal:
- resource unit `octoport-test-c-15c6fc5902df4cf582a19fa936c39c65.service`;
- exit 0;
- peak 673 MiB;
- cleanup verified.

Results:
- backup + release-verifier Python tests: 18/18 PASS;
- Telegram operator tests: 53/53 PASS;
- Telegram typecheck/build: PASS;
- API-watch tests: 166/166 PASS;
- API-watch typecheck/build: PASS;
- shell syntax for ops scripts: PASS;
- Python compile for ops tooling/tests: PASS.

Additional source-only operational evidence:
- synthetic render + `systemd-analyze verify` for Telegram service and backup service/timer: PASS;
- no unresolved template tokens;
- real host currently lacks `pg_dump`/`pg_restore`; backup installer fails closed before unit mutation and the target unit state remains unchanged;
- installer does not install OS packages, enable units or start units;
- no protected environment values were read or copied.

## Exact immutable ops release evidence

Exact source SHA:
`69db39e795010d0f9acfc9ffcaef76b38f5f59b3`.

Exact source tree:
`6305395fc0dcf07dec5c3ffa6db2d4b59692b8f3`.

Builder:
- resource unit `octoport-test-c-3593a7b452734293bd63b12348c6a32d.service`;
- frozen offline install;
- Telegram config test/build;
- production-only dependency install;
- permission normalization;
- empty-environment closure gate;
- complete file/symlink inventory;
- self-verification;
- exit 0;
- peak 541 MiB;
- cleanup verified.

Verifier readback:
- status PASS;
- files: 24,844;
- symlinks: 915;
- source SHA/tree match exact runtime source;
- non-root service-user Node/tsx/entry readability: PASS;
- non-root runtime reaches expected `TELEGRAM_OPERATOR_CONFIGURATION_MISSING`;
- no `ERR_MODULE_NOT_FOUND`, type-stripping error or `EACCES`;
- representative esbuild JS is mode 0644, tsx CLI 0755, built entry 0644.

Sanitized out-of-tree evidence:
`/root/octoport-control/logs/C/OPS_RELEASE_69DB39E7_EVIDENCE_2026-09-25.json`,
SHA256 `a684e26a283f9e77300c2d17296c8adaada4660bb8e1ad507dbf8abcdc0423c4`.

The documentation commit containing this receipt is not an ops-runtime input change; the deployable ops runtime remains pinned to exact source `69db39e7...` unless a later accepted change touches an ops runtime/release path.
