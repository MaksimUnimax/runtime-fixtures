# C06 exact STORE 0.2.11 authenticated-control preparation — 2026-10-01

Status: **PREPARED_EXACT_STORE_OWNER_CONTROL / HELPER 22/22 PASS / EXACT PREPARE PASS / NO AUTH OR LIVE ACTION EXECUTED**.

Task: `C06-STORE0211-AUTHENTICATED-CONTROL-PREPARATION`.

This task prepares the already-existing fail-closed owner-control helper for the exact frozen STORE 0.2.11 package. It does not perform ordinary login, technical auth, local-matrix mutations, provider checks, Work, transfer or auth reset.

## Exact inputs

Chromium STORE package:
`/root/octoport-control/logs/C/store-release-0211-7353c996/candidate/OCTOPORT_v0.2.11_CHROMIUM_STORE.zip`

SHA-256:
`66c8b34e533f0e716cc3b7d214127a8443e89a241682d2307487c96a373f07c9`.

Package source:
`7353c996fb72b62196d57ef2dbcd5c8339057dba`.

Browser executable:
`/usr/bin/opera`.

Observed product:
`136.0.6008.22`.

Existing helper:
`tests/regression/extension-core/client-i1/exact-store-authenticated-controls.py`.

Helper SHA-256:
`efbca69acce0b226610628b7f1d2c30f207727f09a063394eface0cd08c0df6b`.

The helper docstring/default arguments still name historical 0.2.6, but its actual package/version/hash inputs are parameterized. This preparation used explicit 0.2.11 values; no helper source change was required.

## Focused helper verification

Guard suite:
`python3 tests/regression/extension-core/client-i1/test-exact-store-helper-guards.py`

Result: **22/22 PASS**.

Evidence:
`/root/octoport-control/logs/C/c06-store0211-authenticated-control-prep-20261001/helper-guards.log`

SHA-256:
`4250c3a72ec870fb7949ff421c8c942032d4162a612166d689328d4f90dff5c9`.

The first capture attempt produced an empty file because unittest writes progress to stderr. The same small guard suite was rerun once with stderr captured; this is evidence-capture correction, not product rework.

Describe mode produced the existing ten-phase plan and was not modified:

1. exact identity;
2. ordinary auth;
3. reversible safe-state temporary-store matrix;
4. local options;
5. privacy-safe diagnostics;
6. backup;
7. provider checks — gated/not run by helper local matrix;
8. Work — gated/not run;
9. transfer — gated/not run;
10. auth reset — gated/not run.

Describe evidence:
`/root/octoport-control/logs/C/c06-store0211-authenticated-control-prep-20261001/describe.json`

SHA-256:
`7d89ac17250a61df215f2851360d19e668cc58526c92ef77d3603ae73cb06445`.

## Exact prepare result

`prepare` was run with explicit:

- expected version `0.2.11`;
- expected SHA `66c8b34e...07c9`;
- expected Opera product `136.0.6008.22`;
- exact frozen carrier above;
- dedicated stable runtime/profile paths.

Safe result:
`/root/octoport-control/logs/C/c06-store0211-authenticated-control-prep-20261001/prepare.json`

SHA-256:
`412fc271c95b37e112652e630291be39985af60b1969783f2c98f4020083d2c1`.

Result:

- status: `PREPARED`;
- exact carrier name: `OCTOPORT_v0.2.11_CHROMIUM_STORE.zip`;
- exact package SHA matched;
- browser product matched `136.0.6008.22`;
- runtime files: `43`;
- runtime created: `true`;
- profile in use: `false`;
- `manifestKeyPresent=false`;
- stable path required: `true`.

Prepared stable runtime:
`/root/octoport-control/profiles/C/store0211-full-controls/runtime`.

Prepared dedicated profile:
`/root/octoport-control/profiles/C/store0211-full-controls/profile`.

Profile mode is `0700` and was empty immediately after prepare. No process referenced the prepared profile after the preparation command exited.

Extracted runtime manifest version is `0.2.11`; manifest SHA-256:
`de334b9cf5efced070bbd96bc531157e00bc356c6d9ad0d93fd3409d643ca82d`.

## What prepare did not do

No browser session was launched by this task.

No:

- `auth-start`;
- portal login;
- OTP;
- technical-auth approval;
- access/refresh token operation;
- temporary-store local matrix;
- provider request;
- ChatGPT send;
- marketplace mutation;
- control-plane mutation;
- transfer;
- auth reset;
- store upload;
- deployment.

Safe machine-readable task result:
`/root/octoport-control/logs/C/c06-store0211-authenticated-control-prep-20261001/RESULT.json`

SHA-256:
`696bb85cb636134a747ad9d17128695e2c1db5e1f7971848e8f0f3953d14dd25`.

## Operator runbook

Prepared runbook:
`/root/octoport-control/operator/C06_STORE0211_FULL_CONTROL_RUNBOOK.md`

SHA-256:
`d857e70c97b2bffd1f6a2f8dabfcfeb8d09dea2e5bac6acead00c31dea08fe76`.

The runbook uses ordinary `wait-auth` only. It does not use the currently platform-blocked technical-auth automation.

It separates:

1. ordinary auth lifecycle (`auth-start`, `auth-open`, `auth-cancel`);
2. reversible local matrix for temporary Ozon/WB store UI, confirmation/reject, support and conditional backup;
3. real read-only credential-check buttons as a separate live-provider boundary;
4. Work/useful flow through the separately reviewed A06 manual runbook;
5. transfer only with a second ordinarily authenticated installation;
6. destructive `auth-reset` only last and only under a current authority that allows it.

The runbook forbids storing password, OTP, cookies, tokens, raw provider responses or business payloads in evidence.

## Local-matrix boundary

The existing helper's reversible local matrix is intentionally narrower than the complete 27-button remaining matrix.

It can exercise, after ordinary auth and current temporary-store authority:

- Ozon/WB switch;
- temporary store add/save;
- edit/cancel;
- edit/save with secret-presence preservation without reading secret values;
- `clear-performance` / `personal` local options;
- remove/reject;
- remove/confirm;
- privacy-safe support snapshot;
- backup export/preview/import only when pre-existing store count was zero;
- final cleanup and exact pre-existing store fingerprint restoration.

It fails if provider-host requests occur.

It explicitly does not execute:

- Seller/Performance/WB real provider-check buttons;
- Start/Resume/visibility/Finish/quota Work actions;
- transfer;
- auth reset.

Those remain their own gates and must not be marked PASS from local-matrix preparation.

## Relationship to the exact 0.2.11 control matrix

The accepted exact matrix contains 30 structurally bound buttons and 27 ordinary-auth/live action gates.

This preparation does not close any of those 27 gates. It converts the next manual/reviewer step from a generic instruction into a deterministic exact-package execution plan.

The existing A06 runbook remains separate for one real read-only WB `seller_info` useful flow. It is not silently merged into the reversible local UI matrix.

## Evidence boundary

Evidence level is exactly:
**PREPARED_EXACT_STORE_OWNER_CONTROL**.

It is not:

- ordinary authenticated acceptance;
- LIVE_OWNER;
- provider acceptance;
- real useful-flow acceptance;
- transfer acceptance;
- browser-store installation/update;
- store submission/moderation;
- deployment;
- beta readiness;
- production.
