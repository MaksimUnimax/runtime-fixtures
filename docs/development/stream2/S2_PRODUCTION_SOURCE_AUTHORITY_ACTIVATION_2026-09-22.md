# Stream-2 production source authority activation

## Source registry

The production API-watch registry uses the two architect-supplied Ozon
candidate URLs exactly as provided:

- `OZON_SELLER` — `https://docs.ozon.ru/api/seller/swagger.json`
- `OZON_PERFORMANCE` — `https://docs.ozon.ru/api/performance/swagger.json`

Ozon validation requires the final origin to remain `docs.ozon.ru`, a JSON
OpenAPI document with non-empty `paths`, and the matching API server identity
(`https://api-seller.ozon.ru` or `https://api-performance.ozon.ru`) plus a
compatible title.

Wildberries remains one source family with thirteen required documents. Each
document is retained under its exact `documentKey`, official URL, artifact
type, SHA-256, and per-document authority state. The required keys are
`WB_01_GENERAL` through `WB_13_FINANCES`, mapped to the supplied
`dev.wildberries.ru/api/swagger/yaml/ru/*.yaml?region=ru` URLs.

The family is `AUTHORITY_ACCEPTED` only when all thirteen documents are
accepted. A partially observed family is `AUTHORITY_PARTIAL`; a family with
no accepted documents and unresolved external authority is
`AUTHORITY_BLOCKED`. The family manifest is a canonical, document-key-sorted
record of `documentKey`, SHA-256, byte size, and detected specification
version. Raw YAML documents are never concatenated to form identity.

## Acquisition and operator handoff

Automatic acquisition is bounded HTTP GET with the existing redirect, size,
timeout, parser, and accepted-host checks. It never uses mirrors, browser
sessions, credentials, anti-bot workarounds, or marketplace APIs.

The supplied Ozon URLs were attempted directly on 2026-09-22. Both returned
repeated same-host HTTP 307 redirects and were rejected by the maximum
redirect policy. Neither produced accepted source bytes, a SHA-256, or an
inventory.

All thirteen supplied Wildberries URLs required legitimate operator access
in the bounded run. The resulting document-scoped operator request identities
are deterministic:

`WILDBERRIES:WB_01_GENERAL` through `WILDBERRIES:WB_13_FINANCES`.

Each request is bound to `sourceFamily + documentKey + officialUrl`, expects
`YAML`, and cannot be satisfied by an upload for another document key. The
Telegram upload remains a quarantined
`OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE`; existing A1 authority review
is still required before A2 snapshot promotion.

No automatic retry is applied to the Wildberries operator-required results.
No operator file was uploaded by this execution.

## Pipeline state

The production pass executed A1 acquisition. A2 through A10 did not run for
the live sources because no source reached accepted authority. The deterministic
fixture pipeline and source-set tests remain the automated coverage for the
downstream stages. The production source state is therefore not represented
as live monitoring readiness.

Production PostgreSQL integration requires an authorized Stream-2
`DATABASE_URL`. When it is absent, durable request persistence is not claimed
from an in-memory live probe; the integration result is recorded as
`ENVIRONMENT_DEFERRED_DATABASE_URL`.

## Security boundary

The source authority flow has no mirror fallback, anti-bot bypass, browser
session reuse, marketplace credential use, remote code execution, product
adapter mutation, auto-enable, auto-disable, heartbeat, or Stream-1
authority effect. Runtime snapshots use generated content-addressed paths;
source filenames are metadata only.
