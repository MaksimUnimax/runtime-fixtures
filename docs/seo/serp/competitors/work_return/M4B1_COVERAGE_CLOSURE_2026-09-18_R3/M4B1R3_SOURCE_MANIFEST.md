# M4B1 R3 reacquisition source manifest

WORK_ID: `OCTOPORT_SEO_M4B1_R3_REACQUISITION_2026-09-22_R1`  
Repository: `MaksimUnimax/runtime-fixtures`  
Branch: `seo/wordstat-batch-01-2026-09-16`  
START_HEAD: `35e39d98e74aea75ba90b817bc267763fbd23e76`  
END_OBSERVED_HEAD: `35e39d98e74aea75ba90b817bc267763fbd23e76`  
Authority drift status: **NONE**  
Verdict candidate: **PASS**

## Frozen pre-R3 authority

- Authorized entities: 45.
- Accepted M4A anchors: 100.
- R1 URL/page rows: 372 / 249.
- R2 initial navigation delta / recursive new identities / page evidence: 835 / 405 / 579.
- Frozen pre-R3 normalized universe: 1,612.
- R2 open URL unresolved: 0.
- Frozen blob identities matched the released reacquisition prompt before acquisition.

## Fresh current public reacquisition

- Every public robots.txt and declared/conventional sitemap endpoint was checked inside the frozen 45-entity scope.
- Accessible sitemap indexes were expanded to closure. Broad sitemap entries were admitted only when the frozen host/path/theme rule matched.
- Pagination/load-more traversal was limited to accepted collection roots and closed through explicit numeric/next/repeated-listing evidence.
- Unrelated body links, footer links, recommendation widgets, generic corporate/media links and the R2 416 child-link diagnostic queue were not used as a mandatory crawl frontier.
- Fresh current normalized identities: 11222.
- Fresh INSPECTED identities with structured page evidence: 5118.
- Execution-environment failure terminals: 5971.
- Independent live-browser readback of `https://uniseller.io/blog/` during this reacquisition exposed 5,574 public anchors and 5,474 unique same-host `/blog/` identities; all 5,474 had visible text labels. This confirms that the large current Uniseller collection surface is public DOM evidence rather than a whole-domain crawl artifact.
- Terminal-state distribution: ACCESS_BLOCKED=10, AUTH_REQUIRED=2, DUPLICATE_CANONICAL=19, EXECUTION_ENVIRONMENT_FAILURE=5971, HTTP_ERROR_502=1, HTTP_ERROR_503=97, INSPECTED=5118, NON_HTML=1, NOT_FOUND=1, REDIRECT_OUT_OF_SCOPE=2.
- Open URL unresolved: 0. Blocking channel HOLD: 0. Silent URL loss: 0.

## Current versus historical R3

- Historical accepted R3 comparator: 2,888 new identities; 2,845 INSPECTED; 43 execution-environment failures; 4,500 post-R3 merged identities; open unresolved 0; silent loss 0.
- Current merged pre-R3 plus fresh R3 universe: 12834.
- Classification: `CURRENT_PUBLIC_DRIFT_DETECTED`.
- The current public surface is preserved as reacquired evidence. Accepted R4/R5 history is not rewritten by this return.

## Boundaries

- Public exact URLs only. Login, credentials, CAPTCHA/anti-bot bypass, private APIs and session extraction: 0.
- Search-provider, Wordstat, Alice and M4Q calls: 0.
- New competitor entities: 0.
- Final cluster, query-to-page, URL, H1, Title and IA decisions: 0.
- Competitor wording remains candidate evidence, not proven demand. Competitor claims remain external evidence, not Octoport fact.
- GitHub writes by Work: 0.
