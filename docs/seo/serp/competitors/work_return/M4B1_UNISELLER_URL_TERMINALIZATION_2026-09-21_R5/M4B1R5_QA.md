# M4B1 R5 QA

WORK_ID: OCTOPORT_SEO_M4B1_UNISELLER_URL_TERMINALIZATION_2026-09-19_R5

QA_VERDICT: PASS

## Authority

- Start remote HEAD = b5eecfede1f3dde1d8e583a6031d6733232e22f6: PASS
- End observed remote HEAD = b5eecfede1f3dde1d8e583a6031d6733232e22f6: PASS
- Material authority drift = false: PASS
- Frozen baseline terminal universe = 4510: PASS
- Frozen R4 Uniseller aggregate residual = 5431: PASS
- Other 44 entities unchanged: PASS

## Lossless collection accounting

- Current live collection occurrence rows = 5475
- Current live collection unique normalized identities = 5474
- Current live article identities = 4307
- Current live theme-taxonomy identities = 1166
- Current live root identities = 1
- Duplicate-within-R5 occurrence rows = 1
- Already-accepted identities = 19
- New in-scope identities = 5455
- New out-of-scope identities = 0
- Exact identities successfully materialized = 5474
- Exact new terminal identities = 5455
- INSPECTED = 5455
- NOT_FOUND = 0
- Environment/access terminal = 0
- Exact remaining unresolved = 0
- Silent URL loss = 0

Identity equation:

5475 occurrences - 1 duplicate occurrence = 5474 unique identities

5474 live unique - 19 already accepted = 5455 new terminal identities

Global merged terminal universe:

4510 + 5455 = 9965

## URL to evidence reconciliation

- URL overlay rows = 5455
- Page evidence rows = 5455
- URL-to-page-evidence joins = 5455/5455: PASS
- Missing page evidence = 0
- Page evidence unknown URL refs = 0
- Duplicate normalized URL identities in overlay = 0

## Current-state tables

- Discovery channel coverage rows = 45: PASS
- Entity synthesis rows = 45: PASS
- Frontier reconciliation rows = 45: PASS
- REG051 final terminal identities = 5523: PASS
- Global final terminal identities = 9965: PASS
- Open URL unresolved = 0: PASS
- Blocking channel HOLD = 0: PASS
- Accepted R4 channel states were not re-opened: PASS

CHANNEL CLOSURE: already complete in R4; preserved with zero HOLD.

URL TERMINALIZATION: complete in R5; every current newly recovered identity is materialized, terminal and joined to structured collection evidence.

## Boundary checks

- R1/R2/R3/R4 replay = 0: PASS
- Other entities re-opened = 0: PASS
- Sampling/top-N/truncation = 0: PASS
- Search provider calls = 0: PASS
- Wordstat calls = 0: PASS
- Alice calls = 0: PASS
- GitHub writes = 0: PASS
- Final cluster/page/IA decisions = 0: PASS
- Competitor claim promoted to Octoport fact = 0: PASS
- Competitor topic promoted to demand = 0: PASS

M4B1 UNISELLER URL TERMINALIZATION R5 = PASS

M4B1 page-surface closure is ready for Main Chat acceptance.
