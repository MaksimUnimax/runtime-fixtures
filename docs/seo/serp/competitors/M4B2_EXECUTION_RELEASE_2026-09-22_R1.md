# Octoport SEO — M4B2 execution release

Date: 2026-09-22
Status: **AUTHORIZED / REMOTE READBACK PASS / WORK MAY START**
WORK_ID: `OCTOPORT_SEO_M4B2_CONTEXT_BASELINE_2026-09-22_R1`
Preparation base HEAD: `b76780f21db16493696cdcb179cc28c72af64459`
Preparation commit remote-read back: `68809be4823688ac855486c0985cea23c04cfd05`
Remote readback: **PASS**

## Frozen upstream authority

- M4A R3 accepted.
- M4B1 R5 A1 accepted.
- M4B1 final terminal universe = 9,965.
- M4Q remains separate and is not executed here.

Accepted M4A blobs:
- registry: `822155d7cebcbcf5cf8cdaef0f92782d5f84cd59`;
- page candidates: `c388aba7b1deaded3b5bb46b9d39212cf3eb94db`;
- occurrence ledger: `0028a743c8617c569ba37dfa4b59e92b5f56e18d`.

Frozen M4B2 authority manifest:
- path: `docs/seo/serp/competitors/M4B2_AUTHORITY_MANIFEST_2026-09-22_R1.tsv`;
- blob: `11da16864f67aa4daeabdffef7c8eaaa178bb2ff`.

## Frozen execution unit

Allowed classes only:

- EDITORIAL_OR_PUBLISHER;
- NATIVE_MARKETPLACE_BASELINE;
- AGGREGATOR_DIRECTORY.

Expected:

```text
15 registry entities
43 accepted M4A page-candidate anchors
2 zero-anchor registry entities
4 accepted occurrence bootstrap URLs
47 execution seed rows
```

No other entity may enter.

## Allowed external action

Public browsing/capture is required.

No Search, Wordstat, Alice or M4Q provider calls.

No login/CAPTCHA/paywall/private-API bypass.

No whole-domain crawl.

## Work preflight

Work:
1. fetch live branch and record HEAD;
2. read gate/release/prompt/authority manifest;
3. verify M4B1 final acceptance remains current;
4. verify M4A input identities;
5. reconcile exact 15/43/2/4/47 counts;
6. HOLD on material mismatch;
7. otherwise execute.

## Return

Exactly 9 outputs defined by the gate.
One ZIP.
No GitHub write by Work.

Owner staging:

`docs/seo/serp/competitors/work_return/M4B2_CONTEXT_BASELINE_2026-09-22_R1/`


## Release verification

Remote readback of the preparation commit independently confirmed:

```text
AUTHORITY_MANIFEST_ROWS = 47
UNIQUE_AUTHORIZED_ENTITIES = 15
PAGE_CANDIDATE_ANCHORS = 43
ZERO_ANCHOR_BOOTSTRAP_URLS = 4
ZERO_ANCHOR_REGISTRY_IDS = REG032 | REG033

EDITORIAL_OR_PUBLISHER_ANCHORS = 32
NATIVE_MARKETPLACE_BASELINE_ANCHORS = 8
AGGREGATOR_DIRECTORY_ANCHORS = 3

GATE_READBACK = PASS
RELEASE_READBACK = PASS
WORK_PROMPT_READBACK = PASS
STAGING_READBACK = PASS
PROGRESS_READBACK = PASS

M4B2_WORK_START_ALLOWED = true
```
