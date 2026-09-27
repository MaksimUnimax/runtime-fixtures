# B09 STORE-1 v2 signature preflight — 2026-09-27

Status: **SOURCE VALIDATED REWORK CANDIDATE / NO LIVE REQUESTS / NO CATALOG WRITES**

## Scope

Controller assignment: `STREAMS-AUDIT-20260927-0701`.

B09 binds the accepted STORE-1 Opera package and its packaged verifier/trust bundle to current admin config metadata and an ordinary authenticated no-AI v2 bootstrap before catalog mutation. It does not read signing private material or create a signing service.

The initial candidate `b2c5e990` and first correction `ef754939` were not sufficient for final review: C read-only review identified caller-forgeable JSON proof provenance, a too-broad config-successor exception, and missing trusted device/browser context binding. This rework keeps the prior stale-proof fix and closes the remaining provenance/context gaps.

## Source behavior

- Exact package authority remains pinned by `readStore1PackageAuthority`: source `e7d66152bdb77918b65115486c9829ef7a634e69`, tree `01ae2c1d84a354a11d919a313f8d9909d1285b6a`, version `0.2.4`, contract `control_plane_v2`, Chromium/Opera ZIP SHA-256 `0c1fb4c9c81c600332dfb6dc2dcfb9c3221dafe9940eab3811112a4e9fc5d71c`.
- `store1-v2-signature-preflight.ts` reuses the bounded ZIP parser and executes the verifier packaged inside that exact ZIP. It extracts the trust bundle from packaged `service_worker.js`; checked-in LOCAL DEVELOPMENT trust is rejected as STORE evidence.
- The production preflight returns a process-local frozen capability. `planStore1Activation` rejects ordinary/deserialized JSON proof with `STORE1_V2_SIGNATURE_PREFLIGHT_UNTRUSTED`; the plan CLI therefore cannot unlock POSTs by loading a fabricated proof object.
- The no-`detectedAi` request is fixed to v2 / extension 0.2.4 / Opera / authenticated device / `lastConfigVersion:null`.
- The transport response carries the authenticated account/device/browser context used for that request. Preflight requires exact reviewer account, device ID, Opera family and browser version before verifying and issuing the capability.
- Verification requires packaged Ed25519 signature, strict schema and canonical bytes, active expected key, matching config version, signed ACTIVE reviewer account and `ai.status=UNCONFIGURED`.
- The proof binds package hash, canonical trust-bundle digest, config version/content/source hashes, signing key, reviewer account/device and browser context.
- The proof must match the current config identity before every catalog POST. A config CAS makes the prior capability stale; a fresh authenticated signed-bootstrap preflight is required before another mutation.
- Reviewer identity/admission remains a separate prerequisite. No reviewer is created, beta is not opened, and no SQL/live bypass is added.

## Verification

Environment: Node 24.20.0, pnpm 10.34.5.
- Focused planner + signature-preflight tests: **29/29 PASS**.
  - supervisor: `octoport-test-b-7b735d722c8f416ea97991228e757714.service`
  - cleanup verified.
- STORE-1 whole-sequence PostgreSQL integration: **2/2 PASS** on B disposable PostgreSQL.
  - supervisor: `octoport-test-b-2537d5c0a6754a16bf2eac5961d38853.service`
  - proves missing/untrusted/stale proof => zero mutations; trusted fresh proof => normal activation sequence; config CAS forces proof refresh; replay => zero new mutations.
  - cleanup verified.
- Exact accepted local STORE package evidence read: PASS.
  - supervisor: `octoport-test-b-083eccc9cb99415f94bd7b28ce9d7c35.service`
  - package SHA-256 matched accepted authority.
  - canonical packaged trust-bundle SHA-256: `c0bce660c6d6c2c1fa2f4cb57c336aa12c5b638ec74fcf56faf4615ca8e3d4c7`.
  - packaged active key id: `octoport-preprod-2026-09-19`.
- Targeted ESLint: PASS.
  - supervisor: `octoport-test-b-5b33076da4f44c4ab3004cbd1d72e655.service`
  - cleanup verified.
- Final Prettier/docs/diff/guard are run immediately before commit.

## Negative coverage

Focused tests reject bad signature, unknown packaged key, config/key/account mismatch, mismatched authenticated device/browser context, correctly signed non-canonical payload, development packaged config, mismatched package bytes, and caller-controlled serialized proof. Planner/integration tests prove all such proof failures stop before catalog POST.

## Boundary

This is SOURCE evidence only. No live API request, protected credential read, live database mutation, reviewer provisioning, compatibility/catalog mutation, deployment, billing action or browser-store action was performed.

C-owned subscription-access v3 foundation remains separate; B will start its producer only after the exact shared v3 foundation is accepted/published for B consumption.
