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

## Verification evidence

The fixture suite uses a local HTTP server for status, redirect, timeout,
oversize, and document validation cases; it does not depend on live Ozon or
Wildberries availability. Node 24.20.0 is the acceptance runtime. PostgreSQL
integration remains separately classified when `DATABASE_URL` is unavailable;
the forward-only migration receipt and non-network database tests remain
runnable.
