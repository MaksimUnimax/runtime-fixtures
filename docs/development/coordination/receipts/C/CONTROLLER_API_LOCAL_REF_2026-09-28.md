# Controller: local schema reference semantics

Owner manual mode, PLAN C03. Follow-up tobcb2207a; three-file candidate.
The parser already accepts OpenAPI3.1, but reference expansion discarded sibling
Schema Object constraints. It also dereferenced literal $ref strings in enum or
default data, causing both missed real changes and changes from unused schemas.

Reference expansion now tracks Schema Object, named schema map, ordinary OpenAPI
object and literal positions. OpenAPI3.1 local schema targets and sibling
constraints are combined; documentation-only siblings remain neutral. Recursive
edges retain sibling constraints. OpenAPI3.0 and non-schema Reference Object
rules remain separate. Literal defaults/enums are never resolved as references.
Swagger2 body schemas retain their explicit schema position.

This is bounded local-pointer fingerprinting, not a full JSON Schema evaluator.
No external reference is fetched and no broad parser/source-authority change is
made. See [OAI reference semantics](https://learn.openapis.org/referencing/overview.html)
and [OpenAPI3.1.0](https://spec.openapis.org/oas/v3.1.0).

Verification: six failures reproduced before repair; API-watch209/209 tests pass,
including12 new dialect/literal/recursive/Swagger2 cases. Typecheck, changed-file
ESLint/Prettier and diff pass. Supervisor0dad4a406b674025bc4939c821a73b8b
exited0, peak685 MiB, OOM0, cleanup verified. Source/local loopback only; no DB,
marketplace call or deployment. Logs under
/root/octoport-control/logs/controller/manual-monitor-explanation-20260928/.
