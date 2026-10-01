# C06 STORE0211 Cross-Version AI Profile Regression — 2026-10-01

Verdict: **PASS — DISPOSABLE POSTGRESQL / SOURCE REGRESSION**.

## Scope

This regression closes the exact server-side coverage gap exposed while checking the preserved Opera 0.2.9 profile. The existing B04 cross-version proof covered refresh and 0.2.11 compatibility, but did not include a published AI profile assignment and used no predecessor config context.

The change is test/evidence only. No production API, bootstrap, auth, profile, schema, migration, runtime, store package or live service code is changed.

## Exact scenario

The disposable PostgreSQL fixture now uses the existing production repositories and services to model:

- an already-authorized Opera 0.2.9 device/session;
- a published predecessor v2 config and a consecutive target v2 config;
- the existing commercial-access stack so AI resolution is reached while beta admissions remain zero;
- the canonical STORE1 ChatGPT Web / Opera profile content, compatibility contract, profile key and content hash;
- the existing profile lifecycle and ACCOUNT-scope Opera assignment;
- normal refresh-token rotation, without device re-registration;
- exact target client identity `0.2.11` / Opera `136.0.6008.22`;
- non-null `lastConfigVersion` equal to the predecessor config;
- detected AI `chatgpt / web / null`.

The positive case verifies a signed v2 target snapshot with the same account/device authority, extension/browser `SUPPORTED`, AI `RESOLVED`, and the exact canonical STORE1 profile key/hash/compatibility. It also verifies one device, one session, two refresh rows after rotation, and zero beta admissions.

The paired negative case keeps the account commercially eligible but omits the AI catalog/profile/assignment material. The signed bootstrap remains HTTP 200 and fails closed as `UNAVAILABLE / UNSUPPORTED_DETECTED_AI`; it does not invent a profile.

## Verification

Static checks on Node `v24.20.0`:

- `git diff --check`: PASS;
- focused ESLint for the changed integration test: PASS;
- Prettier for the integration test and this receipt: PASS.

Disposable PostgreSQL final run:

- command: full `tests/integration/server/p3-4-bootstrap.integration.test.ts`;
- result: **21/21 PASS**;
- log: `/root/octoport-control/logs/C/c06-cross-version-ai-profile-regression-20261001-pg-r3.log`;
- resource receipt: `/root/octoport-control/resource-jobs/14f42689d70a4b39bf8cee191ac125c6/receipt.json`;
- resource result: exit 0, peak 441,450,496 bytes, OOM kills 0, cleanup verified.

Diagnostic history retained:

- first full run: 18/21 PASS; fixture did not model eligibility and also changed one legacy target-policy expectation;
- focused diagnostic proved the pre-AI access gate returned `NO_PROFILE` before the AI resolver;
- second full run: 20/21 PASS after real commercial eligibility; positive canonical profile resolution passed, and the only remaining mismatch was the deliberately empty AI catalog reason;
- final run: 21/21 PASS after restoring the actual empty-catalog contract `UNSUPPORTED_DETECTED_AI`.

## Relation to preserved-profile evidence

This regression proves that a **still-valid** existing 0.2.9 device/session can refresh and receive a signed compatible 0.2.11 snapshot with the canonical ChatGPT/Opera profile and predecessor config context. It does not make the currently preserved old credential valid again.

The separate preserved-profile task remains blocked because its latest fresh-copy normal refresh returned `AUTH_REFRESH_INVALID` before bootstrap. The earlier isolated `BOOTSTRAP_PROFILE_INCOMPATIBLE` observation is retained as historical evidence and is not silently reclassified by this disposable regression.

## Limits

Evidence level is `DISPOSABLE_POSTGRESQL / SOURCE`.

It does not prove:

- the current preserved 0.2.9 credential is valid;
- LIVE_OWNER ChatGPT behavior;
- marketplace business operations;
- ordinary human email delivery;
- extension-store publication;
- production deployment.

Independent exact-candidate review and normal Git publication gates remain separate.
