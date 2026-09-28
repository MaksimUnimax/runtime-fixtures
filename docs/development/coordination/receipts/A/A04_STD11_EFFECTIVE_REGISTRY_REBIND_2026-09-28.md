# A04 — STD-11 effective registry rebind — 2026-09-28

Status: **SOURCE CURRENT-AUTHORITY PASS / GENERIC WRITE-OFF CAUSALITY STILL OPEN**

Task: `A04_STD11_EFFECTIVE_REGISTRY_REBIND`.

Parent A source candidate:
`c4a0b5189157f50b91285894c5efa2b9f1367300`.

Accepted main merged into A:
`0c7d1eac84ed4ff5fa4e2c31dd7204ee157ef757`.

Shared WB authority now accepted in main:
- implementation: `bac8cc88bb58298b07d2235390363aa706abe43a`;
- C receipt: `847d99230644844ea9241100175771d2badd42b3`.

A post-main merge head before this rebind:
`03a31d68647b2b942265681ac11fb4676ed6cf01`.

## What changed

The prior A preparation proved that STD-11 could distinguish the frozen WB donor
from an effective product registry and could detect the pinned C
`analytics_item_returns` addition.

After C promoted that authority into accepted main, this follow-up binds the
current A evidence to the published product state:

- frozen donor still does **not** contain `analytics_item_returns`;
- accepted effective registry now **does** contain it;
- current effective alias remains:
  `analytics_item_returns`;
- method/path:
  `GET /api/analytics/v1/item-returns`;
- effect/current/enabled:
  `READ / true / true`;
- required/query identity:
  `dateFrom,dateTo,status,limit,offset`;
- deprecated `goods_return` remains current before its separate retirement
  boundary.

The former shared-authority dependency is removed from STD-11. The remaining
external boundary is only:

`GENERIC_WRITEOFF_TRANSFER_CAUSALITY_UNVERIFIED`.

A stock decline without explicit provider event evidence is still
`UNKNOWN_CAUSE`; neither a goods-return row nor an item-returns row proves a
generic write-off or transfer cause.

## Aggregate registry correction

The business coverage aggregate previously validated WB mappings directly
against the frozen donor. That was no longer the product registry boundary once
C introduced effective overlays.

The aggregate now:
- keeps the frozen donor SHA guard unchanged;
- loads WB registry layers in exact
  `apps/extension/composition.json` order from the donor through registry
  overlays, stopping before credentials/contracts;
- validates the existing 45 scenario mappings against that effective registry;
- does **not** silently add `analytics_item_returns` to the historical
  STD-11 accepted operation mapping, because the independent
  order-lifecycle snapshot still guards that mapping.

Replacement availability is therefore an explicit effective-authority fact,
not an unreviewed operation-mapping expansion.

## Verification

Exact Node: `v24.20.0`.

Focused:

`node tests/regression/extension-core/wb-inventory-movement-boundary.mjs`

PASS:
- `donorReplacementPresent=false`;
- `acceptedEffectiveReplacementPresent=true`;
- no live/provider data used.

Aggregate:

`node tests/regression/extension-core/business-scenario-coverage.mjs`

PASS:
- scenario rows: 45/45;
- Ozon operation refs: 101;
- WB operation refs: 133;
- numeric cases: 58;
- effective WB operation count: 187.

`git diff --check`: PASS.

Changed evidence SHA-256:
- `tests/regression/extension-core/business-scenario-coverage.mjs`:
  `64bcd83fc2e42a3104cbce5e5de878bbd9aaf46132dfd1c52337a2e96357dfa8`;
- `tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json`:
  `49fe93eafafed22b36f3b40d5e4a89c7ac5e500dde390a57f08f49ec4e8a4b73`;
- `tests/regression/extension-core/fixtures/wb-inventory-movement-boundary-v1.json`:
  `b943d3c11367c5b934c23a73e9b83636110077492190bd9953fb8d5028f09b4e`;
- `tests/regression/extension-core/wb-inventory-movement-boundary.mjs`:
  `16f234662da73c59510ceb5da16a4e7a35c411cd9cab289eb7f9590eae353118`.

No product runtime/package bytes changed in this A follow-up. No provider request,
browser run, installed acceptance, owner session, deployment or production
acceptance is claimed.

## Remaining boundary

STD-11 shared WB replacement authority is no longer a blocker.

Still open:
- generic write-off/transfer causality without an explicit provider event family;
- live owner/provider gold-set evidence where later required;
- separate retirement of deprecated `goods_return` at its authority boundary.

Evidence level: **SOURCE only**.
