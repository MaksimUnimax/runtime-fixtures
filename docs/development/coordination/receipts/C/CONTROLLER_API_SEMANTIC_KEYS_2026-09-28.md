# Controller: preserve real API fields in semantic comparison

Owner manual mode, PLAN C03. Baseb7de6d61 on mainc08a0849; bounded five-file patch.
The old generic canonicalizer removed description/example/examples everywhere,
including business field names, literal enum/default objects and security scheme
names. Plain object assignment also discarded a real __proto__ field. These are
false negatives: a field type or security requirement could change unnoticed.

Normalization now distinguishes schema nodes, named field maps and literal data.
Documentation annotations are still ignored on nodes. Named properties and literal
values are preserved, with stable object/enum ordering and safe own-key creation.
Security names/requirements remain literal; scheme documentation stays ignored.
Both comparison sides are rebuilt from accepted source bytes already read, so an
old cached fingerprint cannot create a spurious change after a normalizer upgrade.
No accepted source bytes, baseline authority or historical diff are rewritten.

Reference: [OpenAPI3.0.3 Schema Object](https://spec.openapis.org/oas/v3.0.3.html#schema-object).
This is not a claim of complete OpenAPI3.1 reference/dialect support.

Verification:18 failures reproduced before repair (17 semantic cases plus stale
cache case); API-watch197/197 tests pass after repair, including21 new tests.
Typecheck, changed-file ESLint/Prettier and diff PASS. Supervisor
3e5c823b5677497f9217b7a49f761155 exited0, peak637 MiB, OOM0, cleanup verified.
Local loopback fixtures only; no real marketplace calls, DB writes or deployment.
Logs: /root/octoport-control/logs/controller/manual-monitor-explanation-20260928/.
