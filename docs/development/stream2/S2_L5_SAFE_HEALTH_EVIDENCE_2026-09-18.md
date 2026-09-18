# S2-L5 R1 — Safe Health evidence artifacts

Work ID: `S2_L5_SAFE_HEALTH_EVIDENCE_ARTIFACT_FOUNDATION_2026-09-18_R1`

Status: `S2_L5_SAFE_EVIDENCE_ARTIFACT_FOUNDATION_CANDIDATE`

This document records the bounded R1 implementation only. It does not establish
durable artifact storage, retention, incidents, scheduling/P8.5, live provider
health, or architectural acceptance.

## Provenance and scope

- Exact parent: `176c4d8f757bba861f89f60527d7d8dd5dbafddd`
- Parent tree: `c9d709e9dbb18ee00969c12de9fc98cfff7992e2`
- Current integration observed: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
- Historical Health authority: `d4bae8752c304cd49ef5c0f4ef2b5d44281d0f95`
- Branch: `feature/stream2-health-l5-safe-evidence-2026-09-18`

The current checkout did not contain the two historical B5/B6 documents at
`docs/server/`. Their exact historical content was read from the local Git
object for `d4bae8752c304cd49ef5c0f4ef2b5d44281d0f95` and the local accepted
Health authority checkout. The implementation preserves their strict capture
boundary, no recursive source copying, no fake bounded fragments, no raw error
retention, and random-run/no-dedup semantics.

Only Health-runner, Health-facing integration tests, package metadata/lockfile,
and this document are in scope. No Stream-1, adapter, auth, browser strategy,
scheduler, incident, or migration path changed.

## Previous evidence gap and RED audit

The accepted B5 mapper emitted opaque references for approved metadata and state
transition observations, but `sha256` and `sizeBytes` were null and there was no
safe artifact record. It also returned only a persistence command, so no package
carried the detailed S2-L4 classification alongside the exact mapped results.

The exact-parent RED was established before implementation:

| RED | Exact result on the parent | Resolution |
| --- | --- | --- |
| E-RED-01 | The new package API was absent; the RED assertion failed with `createH3HealthEvidencePackage is not a function`. Existing references had no payload owner. | Added one canonical package API and artifact records. |
| E-RED-02 | Existing `evidenceFor()` explicitly returned `sha256: null` and `sizeBytes: null`. | Hash and exact UTF-8 size are now computed for every R1 artifact. |
| E-RED-03 | The parent had no reference/artifact bijection validator. | `validateH3HealthEvidencePackage()` now rejects duplicates, orphans, ownership, type, hash, and size mismatches. |
| E-RED-04 | The parent mapper had no artifact canonical-byte/hash authority, although the repository already had a suitable canonical JSON utility. | R1 schema-parses payloads, reuses `canonicalizeJson()`, then hashes the canonical UTF-8 bytes. |
| E-RED-05 | The parent returned no detailed classification package summary. | The package calls `classifyHealthDetailed()` on its exact persistence-command results and freezes the result. |
| E-RED-06 | Parent tests proved no fake fragment references but had no R1 artifact schema/policy test for fragment or screenshot generation. | R1 artifact schema admits only the two allowlisted rules; future fragment/screenshot attempts fail closed. |

## Canonical package API

`createH3HealthEvidencePackage(rawExecution, rawContext)` is the canonical
mapping path and returns:

```ts
{
  persistenceCommand,
  classification,
  summary,
  artifacts,
}
```

`createH3HealthPersistenceCommand()` remains available as a compatibility
wrapper over that same path. It returns the package's validated,
artifact-referenced persistence command. No P8.5 idempotency or cross-run
deduplication was introduced; package/run and evidence IDs remain fresh opaque
UUIDs per invocation.

The summary is strict and safe: a fresh run UUID, controlled target key, H3
surface, Health surface key, browser family/version, ephemeral session kind,
profile revision, Health suite machine key/revision, classifier version, and
the authoritative run timestamps. Final `state`, `basis`, finding contour keys,
and bounded environment reasons are in the adjacent authoritative
`classification` value.

## Artifact schemas and limits

R1 production capture admits exactly:

1. `SAFE_ELEMENT_METADATA` with payload kind `SAFE_ELEMENT_METADATA`.
2. `STATE_TRANSITION_TRACE` with payload kind `STATE_TRANSITION_TRACE`.

Both payloads are strict, schema version `1`, and carry only controlled target,
H3 surface, contour key, and Health vocabulary. Metadata payloads carry the
optional Health step, observation status, strategy/fallback outcomes and quality,
structural/behavioral outcomes, environment status/reason, and bounded marker
count. Transition payloads carry the H3 step, event outcome, duration,
transition flag, declared expected transition IDs, selected/primary strategy
outcome, and bounded environment status/reason.

Artifact records carry `evidenceId`, owning `contourKey`, `ruleId`, compatible
`classification: "METADATA"`, canonical payload, lowercase SHA-256, and exact
`sizeBytes`. The compatible METADATA classification is deliberate: the
existing shared/database vocabulary is retained, while the strict payload kind
and rule ID distinguish transition artifacts. No shared enum or database
migration is needed.

Limits are explicit: 4 KiB canonical bytes per artifact, at most 13 artifacts
per package, at most 8 fallback outcomes per contour, at most 13 finding keys,
and at most 6 expected transition IDs per transition payload. Existing H3 event,
observation, and classifier bounds remain active.

## Serialization and integrity

Payloads are parsed by their strict Zod schema before hashing. The accepted
repository `@product/remote-config` `canonicalizeJson()` utility supplies
deterministic JSON with sorted object keys, preserved array order, and UTF-8
bytes. R1 hashes `SHA-256(canonical UTF-8 payload)` and records the exact byte
length. No ordinary insertion-order `JSON.stringify()` is used as hash
authority.

Before a package is returned, validation proves:

- every reference has exactly one artifact and every artifact has exactly one reference;
- evidence IDs are unique and reference IDs match artifact IDs;
- contour ownership, rule allowlist, payload kind, classification, hash, and size match;
- payload scope matches the package target/surface;
- detailed classification equals `classifyHealthDetailed()` over the exact command results;
- no future DOM-fragment or screenshot artifact can enter R1.

The package, artifact list, artifact records/payloads, persistence command,
summary, and classification are recursively frozen before return. R1 artifacts
are in-process capture outputs only. They are not written to the repository,
temporary directories, user home, logs, database blobs, or object storage.

## Privacy and disabled capture policy

The source is strictly parsed before mapping. Unknown prompt, response, DOM,
route, conversation, project, message, cookie, token, storage, seller,
customer, arbitrary metadata, or arbitrary error fields are rejected upstream.
Bounded H3 failure codes remain closed-source vocabulary but are not retained in
artifact payloads; exception messages, stacks, provider response bodies, and
network error text are never copied.

No production R1 path calls or retains `page.content()`, `outerHTML`,
`innerHTML`, evidence `textContent`, screenshot capture, DOM serialization,
selector strings, arbitrary attribute bags, or browser handles. Existing
strategy code may inspect DOM to decide an outcome; that does not authorize
evidence retention. `BOUNDED_DOM_FRAGMENT` and `SAFE_SCREENSHOT_REFERENCE`
remain known future policy vocabulary only and are rejected by the R1 artifact
schema. C07/C09 continue to have no fake artifact/reference.

## Three-target proof

Synthetic deterministic package cases cover `CHATGPT_STANDARD` (profile 2,
surface key `standard`), `CHATGPT_WORK` (profile 1, surface key `work`), and
`ALICE` (profile 1, surface key `alice`) through one implementation path. The
only target identity retained is the controlled target key and safe Health
surface/scope metadata. No target route, conversation, project, or provider
identity is used.

## E01–E35 matrix

The focused `apps/health-runner/src/h3-health-persistence.test.ts` matrix maps
as follows:

| IDs | Test proof |
| --- | --- |
| E01 | Package creates an artifact for represented references. |
| E02 | Metadata and transition kinds are the only emitted kinds. |
| E03 | Three-target package test checks opaque UUIDv4 run identity; focused reference checks cover artifact UUID shape. |
| E04–E08 | Reference-to-artifact equality plus canonical SHA-256 and exact byte length. |
| E09–E10 | Repeated identical payloads have identical hash/size; bounded marker change changes hash. |
| E11–E12 | Strict payload and artifact unknown-field rejection. |
| E13–E19 | Prompt, response, DOM, route/conversation, cookie/token/storage, seller/customer, and arbitrary-error sentinel rejection/serialization scan. |
| E20–E23 | Target/surface, browser family/version, profile revision, suite revision, and classifier-safe summary fields. |
| E24–E26 | Detailed state/basis, bounded finding keys, and bounded environment reasons. |
| E27 | Fallback strategy/outcome/quality preservation. |
| E28 | Stable artifact ordering and repeated canonical payload ordering. |
| E29–E33 | Duplicate ID, orphan reference, orphan artifact, hash/size, and type mismatch rejection. |
| E34 | Recursive package/artifact/payload/classification immutability. |
| E35 | Fragment/screenshot rules are rejected and never generated. |

Additional coverage checks artifact count and fallback/finding/transition bounds.

## Persistence and validation results

- Focused safe evidence test: `45/45 PASS`.
- Full health-runner unit suite: `185/185 PASS` across 12 files.
- `@product/health` unit suite: `57/57 PASS`.
- Health-runner and Health typechecks: `PASS`.
- DB package typecheck: `PASS`.
- DB package unit suite: `12/12 PASS`.
- H3 Health PostgreSQL integration with a disposable PostgreSQL 18 container:
  `18/18 PASS`; non-null hash/size references read back exactly and no payload
  column was added or written.
- Existing DB Health persistence integration: `20/21 PASS`; the unchanged
  classifier-derived UNKNOWN fixture fails at the accepted L4
  `INCOHERENT_ENVIRONMENT_OBSERVATION` authority before persistence. This is a
  pre-existing test/fixture mismatch outside R1; no DB production code or
  classifier was changed.
- No migration was added or modified.

## Repository gates and audit status

- Health-runner build: `PASS`.
- Root typecheck: `PASS`.
- Root build: API, Worker, Health-runner, Portal, and Admin completed
  successfully (`PASS`).
- Targeted ESLint: `PASS`.
- Prettier on touched files: `PASS`.
- `git diff --check`: `PASS`.
- Bridge guard and full repository lint/docs checks: `PASS`.

The final source privacy scan covers the touched production paths. Matches for
terms such as prompt/response/DOM/route/conversation/error are boundary comments,
closed schema names, or rejection-test vocabulary; no forbidden source value is
read into an artifact payload. There are no calls to providers, no live browser
provider tests, and provider/live-call count is `0`.

## Deferred boundary

R1 establishes only a safe in-process artifact foundation candidate. Durable
artifact object storage, retention, incident lifecycle, scheduler/P8.5, and
operator workflows remain future work. The exact next autonomous Stream-2 step
is to run the final repository lint, bridge guard, docs check, and a clean full
root build/CI composition, then submit this bounded candidate for independent
architect review without adding durable storage or live-provider work.
