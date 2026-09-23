# S2-L5 R3 — Safe Health evidence final consistency correction

Work ID: `S2_L5_SAFE_EVIDENCE_FINAL_CONSISTENCY_CORRECTION_2026-09-18_R3`

Status: `S2_L5_SAFE_EVIDENCE_ARTIFACT_FOUNDATION_FINAL_CANDIDATE`

This bounded correction does not establish architect acceptance, durable
artifact storage, scheduling, incidents, S2-L6, authenticated sessions, or
live-provider acceptance.

## Provenance and owner cursor

- Exact starting parent/HEAD: `df4b7d31475552fd8a37ab5834661fb1dd9d82c8`
- Exact starting tree: `8213de44a4a89091cf277fb82bfe6e6e6ac82ba9`
- Accepted parent before L5: `176c4d8f757bba861f89f60527d7d8dd5dbafddd`
- Reported integration SHA, re-fetched: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
- Historical Health authority: `d4bae8752c304cd49ef5c0f4ef2b5d44281d0f95`
- Stream-2 branch: `feature/stream2-health-l5-safe-evidence-2026-09-18`

Owner correction recorded in the resume cursor: after L5 acceptance, the next
major Stream-2 task is `ALL_8_LLM_NO_SESSION_MONITOR`, covering ChatGPT
Standard, ChatGPT Work where meaningfully distinct, Alice, DeepSeek, Grok,
Claude, Gemini, Qwen, and Kimi. Authenticated sessions and deeper probes remain
deferred until the maximum useful no-session monitor works across all eight
LLMs. No roadmap document was globally reordered in this bounded task.

## Exact D1 source result

The exact command was:

```text
git show df4b7d31475552fd8a37ab5834661fb1dd9d82c8:apps/health-runner/src/h3-health-persistence.ts
```

The committed source is D1 Case A (`TRANSCRIPTION_MISMATCH` in the prior
terminal report), not Case B:

```text
77-90  H3HealthPersistenceCommandSchema includes classifierVersion: z.string().min(1).max(64)
401-414 persistenceCommandFor() parses classifierVersion: context.classifierVersion
```

R3 does not patch that source mapping. The focused exact-path test now proves a
custom `stream2-l4-v-test` value in the package command, package summary,
legacy compatibility command, and PostgreSQL readback.

## Complete defect batch and RED results

- D1: not reproduced in exact committed source; classified Case A and covered
  by `R3-RED-01` preservation proof.
- D2: reproduced. The summary had a random pre-persistence `runId`; R3 removes
  the field rather than naming a non-run UUID.
- D3: reproduced. Summary and command were independently self-consistent but
  could diverge; R3 adds fail-closed cross-integrity checks.
- D4: reproduced. Instance Date mutator replacement did not stop
  `Date.prototype.setTime.call(date, 0)`; R3 removes Date instances from the
  immutable package authority.
- D5: confirmed compatibility behavior. The legacy command-only wrapper still
  discards artifacts by design; callers requiring artifact bytes must call
  `createH3HealthEvidencePackage()`. New artifact-aware execution must not use
  the wrapper. No durable retrieval claim or store was added.

RED was established against the exact starting parent before correction:

- `R3-RED-01`: D1 path was already green; exact classifier preservation was
  `NOT_REPRODUCED` as a source defect and retained as a proof test.
- `R3-RED-02`: failed because summary exposed `runId`.
- `R3-RED-03/04`: failed because all summary/surface/target divergences were
  accepted (the surface/target mutations reached the older payload-scope
  error).
- `R3-RED-05`: failed because the prototype Date mutator changed the timestamp
  without throwing.

## Corrections

The evidence package now uses frozen package-local timestamp authority objects
with `toISOString()` and `valueOf()` primitives. It contains no mutable Date
instances, so ordinary assignment and Date prototype internal-slot mutators
cannot alter it. `materializeH3HealthPersistenceCommand()` creates real Dates
only at the legacy DB boundary; the DB schema, repository, migrations, and
legacy command contract remain unchanged.

`assertPackageIntegrity()` now checks, with bounded machine error codes:

| Package summary field | Authority and rejection code |
| --- | --- |
| `surfaceKey` | `persistenceCommand.suite.scope.surfaceKey` / `H3_EVIDENCE_SUMMARY_SURFACE_KEY_MISMATCH` |
| `browserFamily` | command scope / `H3_EVIDENCE_SUMMARY_BROWSER_FAMILY_MISMATCH` |
| `browserVersion` | command scope / `H3_EVIDENCE_SUMMARY_BROWSER_VERSION_MISMATCH` |
| `profileRevision` | command profile / `H3_EVIDENCE_SUMMARY_PROFILE_REVISION_MISMATCH` |
| `healthSuiteMachineKey` | command suite / `H3_EVIDENCE_SUMMARY_SUITE_MACHINE_KEY_MISMATCH` |
| `healthSuiteRevision` | command suite / `H3_EVIDENCE_SUMMARY_SUITE_REVISION_MISMATCH` |
| `classifierVersion` | command / `H3_EVIDENCE_SUMMARY_CLASSIFIER_VERSION_MISMATCH` |
| `startedAt` | command timestamp ISO / `H3_EVIDENCE_SUMMARY_STARTED_AT_MISMATCH` |
| `completedAt` | command timestamp ISO / `H3_EVIDENCE_SUMMARY_COMPLETED_AT_MISMATCH` |
| `surface`, `targetKey` | existing packaged H3 surface→target authority / `H3_EVIDENCE_SUMMARY_SURFACE_TARGET_MISMATCH` |

The validator negative matrix rejects changes to classification, artifact hash,
artifact size, artifact contour, reference artifact ID, reference hash, and
reference size, in addition to every summary mismatch above. All failures are
bounded codes with no raw values interpolated into messages.

The artifact hash remains exactly `SHA-256(canonicalizeJson(payload))`, with
exact UTF-8 byte size. Evidence UUIDs are fresh and opaque per package, but do
not enter payload content or its hash. Repeated identical semantic payloads
therefore retain identical hash and size despite different evidence IDs. The
repository `@product/remote-config` `canonicalizeJson()` remains consumed
authority; it is not moved into Stream-2 ownership.

## Privacy and immutability

The toxic sentinel matrix covers prompt, response, DOM, route, conversation,
cookie, token, storage, seller, and customer values. No sentinel appears in a
package, command, summary, classification, artifact, reference, DB readback,
or error/log output. No DOM or screenshot capture was added. No durable
artifact sink was added; `S2-L5-DURABLE-ARTIFACT-STORE-001` remains
`NOT_STARTED`.

The immutability matrix covers package root, artifacts array/records/payloads,
fallback arrays, classification arrays, summary, ordinary property mutation,
and `Date.prototype.setTime.call()` against both package timestamps. The
timestamp result is unchanged and the prototype mutation throws `TypeError`
because the package authority is not a Date.

## Validation record

Completed before commit:

- focused safe-evidence suite: `63/63 PASS`;
- full health-runner suite from `apps/health-runner`: `203/203 PASS`;
- `@product/health` unit suite: `57/57 PASS`;
- health-runner typecheck: `PASS`;
- DB unit suite: `12/12 PASS`;
- H3 PostgreSQL integration: `18/18 PASS`;
- DB Health PostgreSQL integration: `22/22 PASS`;
- PostgreSQL readback preserves `classifierVersion: "p8.1-classifier-v1"`;
- no browser/provider/live calls: `0`.

The remaining repository-wide gates are recorded in the terminal report after
execution: recursive typecheck, all requested builds, lint, format, bridge
guard, docs check, and `git diff --check`.

## Scope boundary

Changed production/test paths are limited to the H3 persistence package and
index, the allowed H3 PostgreSQL integration test, and this document. No
Stream-1 paths, adapters, auth/session code, Work/Alice private URLs, product
migrations, scheduling, incidents, durable storage, or live providers were
modified.

The bounded result can establish only
`S2_L5_SAFE_EVIDENCE_ARTIFACT_FOUNDATION_FINAL_CANDIDATE`. It does not claim
architect acceptance. The exact recommended next task is:

`ALL_8_LLM_NO_SESSION_MONITOR`
