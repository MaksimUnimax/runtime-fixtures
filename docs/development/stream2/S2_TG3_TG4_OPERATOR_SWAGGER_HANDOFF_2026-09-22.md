# S2-TG3/TG4 operator Swagger handoff

## Scope

The Telegram operator plane remains an operational control plane. It has
`executionAuthority = false`, has no heartbeat, and does not patch product
adapters or Stream-1 authority.

When an official API source cannot be acquired automatically, the source-watch
caller creates a durable request for one of `OZON_SELLER`,
`OZON_PERFORMANCE`, or `WILDBERRIES`. The request contains the official URL,
expected artifact type, creation/expiry state, and a bounded blocker reason.
There is no fallback to arbitrary internet files.

## Operator flow

An authorized numeric Telegram operator uses `/swagger_pending` or the
Swagger/API-lane `Pending source requests` button. An upload is correlated only
by an explicit `/swagger_upload <request_id>` caption or command context.
The accepted extensions are `.json`, `.yaml`, and `.yml`.

The service writes bytes to a generated-name quarantine file before parsing.
The default configurable limit is `MAX_SWAGGER_UPLOAD_BYTES=26214400` (25 MiB).
The parser uses JSON or the safe `yaml` parser; archives, executable content,
unsafe YAML constructors, and non-text content are rejected. The document must
have OpenAPI 3.x or Swagger 2.x version metadata plus object `info` and
`paths` fields.

## Provenance and authority boundary

Each candidate records request ID, source family, official URL, operator ID,
received time, safe filename metadata, byte size, SHA-256, parser result,
detected specification version, validation result, and `OPERATOR_SUPPLIED`
acquisition mode. The final validation state is exactly
`OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE`. It is not accepted authority,
does not update adapters, and is handed to S2-A1 for authority analysis.

The request and artifact metadata are durable in PostgreSQL migration
`0024_s2_tg3_operator_swagger_handoff`; quarantine bytes use the configured
operator-controlled inbox. A repeated request ID plus SHA-256 is deterministic
`DUPLICATE`; a different artifact is retained in quarantine and cannot silently
replace provenance.

## TG2/TG4 verification evidence

Node 24 acceptance uses Node `v24.20.0`. The pre-TG3 TG2 gate passed with
monitoring-control `9/9`, Telegram operator `4/4`, health-runner `302/302`,
monitoring-control typecheck, migration unit checks, and `git diff --check`.
TG3 covers the required 30-case request, quarantine, parser, provenance,
authority-boundary, durability, and non-interference matrix. TG4 extends the
existing Telegram harness across the 30 integrated command, callback, upload,
restart, notification, and security scenarios. No live Telegram token is used
by automated acceptance. The TG4 operator suite is 34/34 and the dedicated
Stream-2 security review is 6/6; source-context review classifies the Telegram
token as transport configuration only, with no token logging or persistence.
