# Stream 2 A1–A3 Runtime API Watch

Status: implementation evidence for A1 runtime source authority, A2 immutable
snapshots, and A3 complete operation inventory.

## A1 source authority

`tooling/api-watch` is the canonical runtime package. Its production registry
contains exactly `OZON_SELLER`, `OZON_PERFORMANCE`, and `WILDBERRIES`.

The registry does not invent provider URLs. When accepted repository authority
does not contain an exact official URL, the entry is explicit
`SOURCE_URL_AUTHORITY_MISSING`. Fixture URLs may be injected through the
registry interface in tests.

When a registered URL exists, acquisition is a bounded HTTP GET with a
20-second timeout, a 25 MiB maximum body, at most three redirects, and a
redirect host set derived from that source entry. No credentials, browser
session, cookie, CAPTCHA, anti-bot, or access-control bypass is used.

Acquisition validates UTF-8 JSON/YAML/YML bytes as Swagger 2.x or OpenAPI 3.x,
records the exact-byte SHA-256, and returns a deterministic outcome. Access
control produces `OPERATOR_SOURCE_REQUIRED`; transient network, 429, and 5xx
conditions remain temporary; malformed or unexpected successful content is
invalid.

`OPERATOR_SOURCE_REQUIRED` creates one durable TG3 pending request for the
source family and exact official URL. Existing open requests are reused. The
`/swagger_pending` command and Swagger/API Telegram button read this same TG3
store. An operator upload remains
`OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE` until the A1 evaluator verifies
request identity, current registry URL, family, quarantine bytes, digest, size,
parser result, and validation result. The default operator policy is
`AUTHORITY_REVIEW_REQUIRED`; uploads do not become authoritative by transport
or validation alone.

Migration `0025_s2_api_watch_authority_snapshots` persists authority records,
snapshot metadata, and inventories. Swagger bodies are not stored in ordinary
relational columns.

## A2 immutable snapshots

Only `AUTHORITY_ACCEPTED` records can be promoted. Accepted bytes are stored
outside Git under the configurable `API_WATCH_SNAPSHOT_ROOT`, defaulting to:

`/var/lib/octoport/api-watch/snapshots`

The content-addressed identity is `sourceFamily + SHA-256`, with generated
paths of the form `<family>/<sha256>.<safe-extension>`. The writer validates
the digest and size, rejects symlinked directories and invalid families, writes
through a private temporary file, synchronizes and closes it, then atomically
finalizes the artifact. Repeated family/digest promotion is idempotent and
different content cannot replace an existing snapshot.

Snapshot metadata records the source family, digest, size, specification
version, official URL, acquisition mode, authority record, timestamp, and
artifact path. Snapshot reads recheck digest and size.

## A3 operation inventory

Every accepted snapshot can be inventoried independently. A3 reads the full
snapshot and records every supported HTTP operation, without sampling or
first-N truncation. The stable operation identity is:

`SOURCE_FAMILY:UPPERCASE_METHOD:NORMALIZED_PATH`

`operationId` is nullable metadata and is not the identity. Inventory metadata
includes tags, deprecation, bounded summary hash, security references,
request-body presence, parameter count, and sorted response status keys. The
persisted aggregate includes path and operation counts, method counts,
deprecated count, and operationId-present/missing counts. Re-running for the
same family and snapshot SHA is deterministic.

A3 intentionally performs no semantic diff or product crosswalk. Those remain
later authority-controlled work. No Stream-1 authority, product adapter,
heartbeat, or auto-patch path is changed by this package.

## A4 semantic diff

A4 compares two immutable A2 snapshots from the same source family through
their complete A3 inventories. The stable identity remains
`SOURCE_FAMILY:UPPERCASE_METHOD:NORMALIZED_PATH`; an operationId rename is a
`CHANGED` operation, while a method or path change is a remove plus add.

Each operation is deterministically classified as `ADDED`, `REMOVED`,
`CHANGED`, or `UNCHANGED`. Changed operations contain only normalized,
field-level before/after deltas. Set-like tags, security references, and
response status keys are sorted and deduplicated. The canonical diff excludes
`createdAt`; `DIFF_SHA256` therefore remains stable across repeated runs and
input iteration order.

Migration `0026_s2_api_watch_semantic_diffs` stores the safe diff summary and
normalized operation delta rows. It does not store source specifications or
raw operation bodies. The semantic identity is unique for source family, base
snapshot SHA, target snapshot SHA, and diff SHA.

A4 does not classify product impact.

## A5 safety and READ_POLICY impact

A5 classifies only A4 operation changes. Severity is ordered
`BLOCKING_RISK > REVIEW_REQUIRED > UNKNOWN > NO_POLICY_IMPACT`.

Removed operations and any security-reference change are blocking risks.
Request-body changes, parameter-count changes, response-status additions or
removals, and deprecated-flag changes require review. Added operations require
review even when their method is GET. OperationId-only, tag-only, and exposed
summary-metadata changes have no policy impact when no other semantic field
changes.

`readPolicyCandidate` is either `NONE` or `REVIEW_REQUIRED`. Only
`NO_POLICY_IMPACT` yields `NONE`; A5 never emits an auto-approved or
auto-enabled operation and never mutates product adapters or Stream-1
execution authority.

## Verification evidence

The fixture suite uses a local HTTP server for status, redirect, timeout,
oversize, and document validation cases; it does not depend on live Ozon or
Wildberries availability. Node 24.20.0 is the acceptance runtime. PostgreSQL
integration remains separately classified when `DATABASE_URL` is unavailable;
the forward-only migration receipt and non-network database tests remain
runnable.
