# A03 Alice universal-binding installed parity

## Scope and evidence boundary

This task is test-only. Product/runtime paths are not modified.

The preserved historical owner-authorized R1 retry on source `6311d021223d1839f78b5d5861c632028e5ebb61` is a real FAIL: Alice identity confirmation passed, then Start timed out waiting for `active_visible`. Its exact result remains in `OWNER_RETRY_RESULT_R1.json`.

Static diagnosis proved the original synthetic fixture omitted the first Alice assistant response required by the existing Work Start correlation protocol. The corrected fixture was committed as `a525892344cb40c7c1256e798b984c7e6ee0531f`.

## One corrected owner-authorized retest

Notice `A-DOT-OWNER-ALICE-CORRECTED-FIXTURE-RETRY-20261005T151101Z` authorized exactly one additional browser invocation.

That single corrected run was executed once through the existing A supervised browser route and is preserved in `OWNER_CORRECTED_RETEST_RESULT_R2.json`.

Observed result:

- evidence level: `INSTALLED_SYNTHETIC`;
- provider: Alice;
- 7/7 lifecycle cases PASS;
- Start sends exactly once and binds the exact synthetic Alice conversation;
- manual Ozon help action stays in the bound dialogue;
- reload restores without replay;
- navigation does not inherit work;
- return restores the original work without replay;
- Finish survives reload without resurrection;
- worker external-provider requests: 0;
- unexpected HTTP requests observed by that run: 0;
- page errors: 0;
- live AI-provider requests: 0;
- marketplace requests: 0;
- heavy resource job exit: 0, OOM kill: 0, cleanup verified.

The once receipt is consumed. No later R3/R4 browser run is authorized or performed.

## Independent R2 review

Independent `gpt-6-luna` review in
`/root/octoport-control/logs/A/A03-ALICE-CORRECTED-RETEST-REVIEW-R2-20261005-result.md`
returned `REWORK_REQUIRED` for two test-boundary defects:

1. page/extension HTTP outside Alice/loopback was recorded but not guaranteed fail-closed before network;
2. failure artifacts could persist raw exception/traceback/request/page-error material outside the bounded support sanitizer.

## R3 fail-closed network and failure-output hardening

Candidate `98bf9b9fa35a7177ebead3b5500c4d6440a5e2b6` changed only this receipt and
`tests/regression/extension-core/browser_conversation_binding_alice.py`.

R3:

1. classifies request destinations as synthetic Alice, loopback, external HTTP, or non-HTTP;
2. installs a context-wide route on both persistent-context lifetimes;
3. fulfills synthetic `alice.yandex.ru`, permits loopback/non-HTTP, and aborts every other HTTP(S) request with `blockedbyclient`;
4. keeps the service-worker fetch fence, storing only a blocked-request count rather than request URLs;
5. stores context request events as class + method only, never raw URL;
6. uses stable bounded failure codes instead of dumping assertion values;
7. removes traceback persistence and failure screenshots.

Independent R3 review
`/root/octoport-control/logs/A/A03-ALICE-PARITY-HARDENING-R3-REVIEW-20261005-result.md`
accepted the network boundary but returned `REWORK_REQUIRED` P2 because the secondary support sanitizer still copied arbitrary strings placed inside otherwise allowlisted fields such as `lastErrorCode`.

## R4 closed-enum diagnostic hardening

R4 keeps the accepted R3 network changes and additionally makes every persisted support string a closed enum:

- AI family, identity status, work state, pending outcome, Start stage/outcome and transport class are exact allowlists;
- diagnostic error codes use an explicit current safe-code allowlist;
- an unknown non-null code becomes the stable literal `OTHER`;
- unknown enum values become fixed `other` or `null`;
- the original unrecognized string is never persisted.

The upstream `SA_SUPPORT_SNAPSHOT` already applies its own `saSupportCode`, `saSupportToken` and transport-class filtering. R4 is a stricter evidence-boundary defense in depth and does not change runtime product behavior.

R4 hardened test SHA-256:
`8bc8c94503aaac789b3ca4b0573e2045236364e6bec07a238b669193413f77e2`.

## R4 verification without another browser run

Author verification:

- Python compile with bytecode disabled: PASS.
- `git diff --check`: PASS.
- known diagnostic enum round-trip: PASS.
- four injected secret-like values, including uppercase credential-like text in every allowlisted string field: excluded from serialized output; unknown codes become `OTHER`.
- URL/network route cases: 6/6 PASS; non-Alice/non-loopback HTTP(S) aborts `blockedbyclient`.
- source assertions: no traceback persistence, no failure screenshot, no raw worker URL list, no raw context-request URL persistence.
- Browser runs after the corrected R2 run: **0**.
- Provider/marketplace/DB/product-runtime mutations during R3/R4: **0**.

## Current acceptance boundary

- historical R1 FAIL: preserved;
- corrected R2 one-shot browser run: PASS and consumed;
- R3 network hardening: source review accepted that specific boundary;
- R3 arbitrary-diagnostic-string privacy finding: fixed in R4;
- exact R4 independent review: PENDING;
- LIVE_OWNER: NOT TESTED;
- STORE package acceptance from this task: NOT CLAIMED;
- live provider / marketplace / deployment / production: NOT CLAIMED.

The preserved R2 run remains the behavioral `INSTALLED_SYNTHETIC` evidence. R3/R4 are source-only hardening and do not create a second behavioral PASS.
