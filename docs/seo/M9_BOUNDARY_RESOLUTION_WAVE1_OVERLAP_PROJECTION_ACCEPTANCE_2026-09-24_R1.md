# Octoport SEO — M9 boundary-resolution Wave-1 overlap projection acceptance — 2026-09-24 R1

Status: **PASS / DETERMINISTIC TOP20 PROJECTION ACCEPTED**
Branch: `seo/wordstat-batch-01-2026-09-16`

Upstream full-export acceptance:
`docs/seo/M9_BOUNDARY_RESOLUTION_WAVE1_EXPORT_ACCEPTANCE_2026-09-24_R1.md`

Projection:
`docs/seo/serp/raw/M9_BOUNDARY_RESOLUTION_WAVE1_2026-09-24_R1/M9BR_WAVE1_TOP20_URL_DOMAIN.tsv.gz.b64`

## Source

Full accepted attachment:
`search-octoport-m9br-wave1-20260924-r1-r125-0-24.json`

```text
FULL_EXPORT_BYTES = 8768838
FULL_EXPORT_SHA256 = 71a33e74c41bfeb73bdcae5d3676df052a9c20bc93a6593bc2aec6821650a841
FULL_EXPORT_REVISION = 125
FULL_EXPORT_ITEMS = 25
FULL_EXPORT_NORMALIZED_ROWS = 2500
```

## Deterministic projection contract

The accepted M9 overlap method uses only:
- exact URL sets for Top10 and Top20;
- domain sets for Top10;
- rank.

Therefore the complete current-overlap projection preserves exactly:

```text
index
rank
url
domain
```

for ranks 1..20 of every Wave-1 query.

No URL or domain re-normalization is applied.

## Integrity

Decoded TSV:

```text
DATA_ROWS = 500
HEADER_ROWS = 1
TOTAL_LINES = 501
UTF8_BYTES = 45666
SHA256 = b01d9c0ccbbfb2c7cfcb5af33762c7d9a74c686c2102e5d1419e1bf97491bb95
```

Gzip:

```text
BYTES = 8247
SHA256 = 340b8eddd72fb2ea85e2ef891018e71ae7dd40d719d6395a842b879a34d9ceb9
```

Repository base64 representation:

```text
CHARS = 10996
SHA256 = dd0834fb24ab4959e56f1af6709090f8cecbe458953fdcf03b624e18c44ba33f
GIT_BLOB = cb2d10581aff2810549fc1a9841b51edb652d428
```

Remote readback after commit independently decoded and recomputed every identity above.

## Full-volume gates

```text
INDEX_SET = 0..24
INDICES = 25/25
ROWS_PER_INDEX = 20/20
RANK_SET_PER_INDEX = 1..20
TOTAL_ROWS = 500/500
EMPTY_URL = 0
INVALID_URL_SCHEME = 0
EMPTY_DOMAIN = 0
```

## Authority boundary

This projection is accepted only as a lossless transport for the exact M9 Top10/Top20 URL/domain overlap calculations.

It does not replace the full accepted export as source evidence and must not be used to infer:
- page type;
- demand;
- new query wording;
- page ownership;
- content/IA decisions.

For the 25 new anchors, page-type authority remains `NA_NOT_AUTHORIZED`.

M10A remains blocked.
