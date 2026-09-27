# B09 STORE-1 v2 signature preflight — 2026-09-27

Status: **SOURCE VALIDATED CANDIDATE / NO LIVE REQUESTS / NO CATALOG WRITES**

## Scope

Controller assignment: `STREAMS-AUDIT-20260927-0701`.

B added a bounded STORE-1 v2 cryptographic preflight before the ordinary-admin activation planner can emit its first catalog POST. The implementation does not read signing private material and does not introduce a signing service.

## Source behavior

- Exact package authority remains pinned by `readStore1PackageAuthority`: source `e7d66152bdb77918b65115486c9829ef7a634e69`, tree `01ae2c1d84a354a11d919a313f8d9909d1285b6a`, version `0.2.4`, contract `control_plane_v2`, Chromium/Opera ZIP SHA-256 `0c1fb4c9c81c600332dfb6dc2dcfb9c3221dafe9940eab3811112a4e9fc5d71c`.
- `store1-v2-signature-preflight.ts` reuses the existing bounded ZIP parser and executes the verifier packaged inside the exact STORE ZIP. It extracts the trust bundle from packaged `service_worker.js`; checked-in LOCAL DEVELOPMENT trust is not accepted as STORE proof.
- The injected transport exposes only latest-config readback and authenticated `POST /v1/bootstrap`; it has no catalog-mutation method and accepts no credential on CLI.
- The no-`detectedAi` request is fixed to v2 / extension 0.2.4 / Opera / authenticated device / `lastConfigVersion:null`.
- Verification requires packaged Ed25519 signature, strict schema and canonical bytes, active expected key, matching config version, signed ACTIVE reviewer account and `ai.status=UNCONFIGURED`.
- The safe proof binds package hash, canonical trust-bundle digest, config version/content/source hashes, signing key, reviewer account/device and browser context.
- Planner requires this proof after CLOSED/verified/admitted reviewer + latest ACTIVE v2 config readback and before release/policy/catalog POSTs.
- After the planner's own single CAS config publication, the proof is accepted only for the immediate successor config version containing exactly the STORE-1 policy on the same signing key. Unrelated/stale successors fail closed.
- Reviewer identity/admission remains an independent prerequisite. No reviewer is created, beta is not opened, and no SQL/live bypass is added.

## Verification

Environment: Node 24.20.0, pnpm 10.34.5.

- Focused planner + signature-preflight unit tests: **27/27 PASS**.
  - supervisor: `octoport-test-b-bcd61f97ff8c4d7cbddfcc63be665df9.service`
  - cleanup verified.
- STORE-1 whole-sequence PostgreSQL integration: **2/2 PASS** on B disposable PostgreSQL.
  - supervisor: `octoport-test-b-415734f3153745258789ca8772f0a8bb.service`
  - proves missing proof => zero mutations; mismatched proof => zero mutations; valid proof => normal activation sequence; replay => zero new mutations.
  - cleanup verified.
- Exact accepted local STORE package evidence read: PASS.
  - supervisor: `octoport-test-b-06cf695d3d8d411cb8cdd483390504dd.service`
  - package SHA-256 matched accepted authority.
  - canonical packaged trust-bundle SHA-256: `c0bce660c6d6c2c1fa2f4cb57c336aa12c5b638ec74fcf56faf4615ca8e3d4c7`.
  - packaged active key id: `octoport-preprod-2026-09-19`.
- Final ESLint: PASS.
  - supervisor: `octoport-test-b-6a0df8aae17245c1939c449273e20325.service`
  - cleanup verified.
- Prettier check: PASS.
- `git diff --check`: PASS.

## Negative coverage

Focused tests reject bad signature, unknown packaged key, config/key/account mismatch, correctly signed non-canonical payload, development packaged config, and mismatched package bytes. Planner tests reject absent proof and mismatched proof before any POST instruction.

## Boundary

This is SOURCE evidence only. No live API request, protected credential read, live database mutation, reviewer provisioning, compatibility/catalog mutation, deployment, billing action or browser-store action was performed.

C-owned subscription-access v3 foundation remains separate and is not modified by B09.
