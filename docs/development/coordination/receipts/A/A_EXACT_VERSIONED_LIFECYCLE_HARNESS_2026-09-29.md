# A — exact versioned lifecycle harness readiness — 2026-09-29

Status: **SOURCE TEST-HARNESS READY / INSTALLED CANDIDATE STILL PENDING**

Task: `A_EXACT_TECHNICAL_LIFECYCLE_REMAINDER_20260929`.

## Trigger

C integrated the exact A transfer repair `7f8357a6ba27cd5f70d724254602ac642e51afa8`
into integration candidate `83035523e8062f9bb7c8392b93c861a8444fd2a2`.
A-owned transfer files are byte-identical between those revisions.

No new versioned extension ZIP/hash has been handed to A yet. Frozen STORE 0.2.6 remains
immutable and its transfer row remains NOT_ACCEPTED.

## Harness preparation

The existing lifecycle and reset harnesses were pinned only to frozen STORE 0.2.6.
They now accept explicit expected package SHA-256 and manifest version while retaining
the frozen 0.2.6 identity as the default for historical runs.

Both harnesses fail closed before browser execution when:
- the carrier SHA-256 differs from the expected value;
- `manifest.json` cannot be read/parsed;
- the runtime manifest version differs from the expected value.


Evidence emitted by future candidate runs records the actual verified package SHA and
manifest version and uses versioned-package evidence labels rather than claiming
frozen-STORE bytes.

The reset harness now resolves only Path-valued CLI arguments. This preserves the
new SHA/version string arguments instead of treating them as filesystem paths.

## Focused validation

Commands/results:
- `python3 -m py_compile` on both harnesses and the new identity regression: PASS.
- `python3 tests/regression/extension-core/client-i1/test-exact-store-technical-package-identity.py`: **4/4 PASS**.
- Regression covers explicit later-version identity, SHA mismatch, manifest-version
  mismatch, and CLI preservation of string SHA/version arguments.
- `git diff --check`: PASS.
- `python3 tooling/coordination/control.py A guard`: PASS; only A-owned test/receipt
  paths are present.

No browser, provider, AI POST, live DB, production or store-channel operation was
performed for this harness-only step.

## Next exact boundary

When C provides the new versioned extension carrier, extracted runtime, exact
SHA-256 and manifest version, A will run the supported two-install technical
lifecycle against those exact bytes: metadata-only recipient, actual credential
import, replay/no-reapply, repeated new request without revision loss, cleanup,
one-device reset/re-auth and preserved-profile isolation.

Until that artifact exists, no installed PASS is claimed and frozen 0.2.6 is not
rerun.
