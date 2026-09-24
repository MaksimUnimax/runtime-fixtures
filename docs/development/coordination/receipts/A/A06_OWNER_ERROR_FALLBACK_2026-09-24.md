# A06 — safe owner-facing error fallback — 2026-09-24

Status: **A-SIDE VERIFIED BLOCK / READY FOR C INTEGRATION REVIEW**
Task: `A06`
Role: `A`

Product commit:
`3ff3f2ac40d470d96cafb8f3761d776a52cbd034`

## Scope

The popup previously had three separate raw-code fallbacks:
- failed popup actions;
- persisted auth `lastError`;
- store verification status.

Known codes now still use their specific owner-facing messages. Unknown codes use one shared `ownerErrorText()` fallback:
- the owner gets a concrete instruction to refresh extension state and retry;
- only an `A-Z0-9_` code up to 80 characters may be displayed as a support identifier;
- arbitrary/untrusted code text is replaced by `UNKNOWN`;
- the runtime error, retry policy, authority decision, storage state and wire protocol are unchanged.

The fallback keeps the existing “Действие не выполнено” prefix for generic action failures, preserving installed acceptance expectations that identify a rejected action without depending on internal codes.
## Verification

Exact-head evidence:
`/root/octoport-control/logs/A/a06-owner-error-fallback-exact-3ff3f2a`

Deterministic development package:
- ZIP SHA-256: `69038665befe80e2b92007857cf96867a96567bd763244d61f0adc377b65af55`;
- repeat archive match: PASS;
- source/extracted byte identity: PASS.

Both source runtime and extracted package:
- `client-support-snapshot.mjs`: PASS;
- popup JavaScript syntax: PASS.

Regression proves:
- known mapped error returns its specific message;
- unknown bounded code `CONTROL_REQUEST_TIMEOUT` is shown only as a support identifier after generic owner guidance;
- unsafe code text `<script>secret</script>` is not echoed and becomes `UNKNOWN`;
- action failures, auth `lastError`, and store verification all route through the same helper.

Build resource receipt:
`31c4594fdbdf4050a55853f5aaa12fa8`
- exit 0; OOM 0; cleanup verified.

Focused resource receipt:
`7abdafb89aa7483bb49cbfea8b6f1c52`
- exit 0; OOM 0; cleanup verified.

## Boundary

This is owner-facing diagnostics only. It does not change the error code itself, retry behavior, Work authority, sync reconciliation, credential-transfer semantics, marketplace requests, N2 wire activation, Firefox AMO status, or publication authority.
