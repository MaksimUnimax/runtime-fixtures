# M4B1 R4 QA

WORK_ID: OCTOPORT_SEO_M4B1_COVERAGE_RECOVERY_2026-09-18_R4

QA_VERDICT: PARTIAL / RECOVERY_REQUIRED

## Frozen baseline

- R3 status = PARTIAL / RECOVERY_REQUIRED: PASS
- Authorized entities = 45: PASS
- Accepted anchors = 100: PASS
- R3 merged normalized universe = 4,500: PASS
- R3 open URL unresolved = 0: PASS
- R3 blocking channel HOLD = 47 across 39 entities: PASS
- R3 sitemap HOLD = 37: PASS
- R3 pagination HOLD = 10: PASS

## Channel closure

- Coverage rows = 45: PASS
- Sitemap recovery attempts = 37: PASS
- Pagination recovery attempts = 10: PASS
- Sitemap channels recovered to terminal non-HOLD = 37: PASS
- Pagination channels recovered to terminal non-HOLD = 10: PASS
- Current sitemap HOLD = 0: PASS
- Current pagination HOLD = 0: PASS
- Blocking channel HOLD = 0: PASS
- Entities with blocking channel HOLD = 0: PASS
- Anchors, navigation/taxonomy, and breadcrumb/local-subtree accepted states preserved: PASS

## URL terminalization — separate hard gate

- R4 materialized URL-overlay rows = 10
- R4 materialized terminal identities = 10: PASS
- R4 INSPECTED identities = 7; structured evidence rows = 7: PASS
- R4 execution-environment terminal identities = 2
- R4 NOT_FOUND terminal identities = 1
- Moysklad pagination delta silent row loss = 0: PASS
- Uniseller aggregate-observed potential new identities = 5,431
- Uniseller identities individually materialized and terminalized = 0/5,431: FAIL
- Open URL unresolved = 5,431: FAIL
- Global silent URL loss = 0: NOT PROVEN; the residual is explicit but its exact URL ledger could not be exported after environment failure
- R4 new normalized identities observed = 5,441 (10 terminalized + 5,431 residual)
- Final merged terminal normalized universe = 4,510

## Boundary checks

- R1/R2/R3 replay = 0: PASS
- Old 416-page diagnostic replay = 0: PASS
- Accepted 4,500-universe replay = 0: PASS
- Unauthorized competitor additions = 0: PASS
- Arbitrary body-link recursion = 0: PASS
- Whole-domain crawl = 0: PASS
- Sampling/top-N substitution = 0: PASS; no partial Uniseller subset is presented as complete
- Candidate terms promoted to demand = 0: PASS
- Competitor claims promoted to Octoport fact = 0: PASS
- Final cluster/page/URL/H1/Title/IA decisions = 0: PASS
- Search-provider calls = 0: PASS
- Wordstat calls = 0: PASS
- Alice calls = 0: PASS
- M4Q calls = 0: PASS
- GitHub commits/pushes/PRs = 0: PASS

## Exact recovery blocker

REG051 Uniseller / PAGINATION_OR_LOAD_MORE: the public collection rendered once with 5,450 unique /blog identities and an enabled next control. Nineteen identities match current authority; 5,431 are potential new normalized identities. The public reader refused the payload because it exceeded 4 MiB, subsequent cloud-browser states returned 502 Bad Gateway, and the Opera connector was unavailable. The pagination channel itself is terminal ACCESS_BLOCKED, but the newly exposed aggregate cannot be converted into the required lossless per-URL ledger and terminal states. Recovery must resume only from this collection; the other 44 entities and all 47 channel states must not be replayed.

M4B1 COVERAGE RECOVERY R4 = PARTIAL / RECOVERY_REQUIRED
