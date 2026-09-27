# C02 A02+B03 joint recipient-restart acceptance — 2026-09-27

Status: **JOINT INSTALLED_SYNTHETIC PASS / NOT LIVE_OWNER / NOT DEPLOYED**

This receipt closes the PLAN requirement that A02 recipient MV3 recovery and B03
bounded ephemeral server relay be reviewed together. It does not broaden browser,
provider, marketplace or deployment claims.

Current integration base: `5499d57cdbff250723ce2497911d36527306b07b`.

Accepted product lineage:
- A02 extension recovery: `02dc7639de915f7d1928e8dd91b6288f06a548be`;
- B03 bounded relay implementation: `ae15d486cef926b48a7f4749dde4c2b6c978a403`;
- coordinated B03 handoff lineage: `615dd763ef115ba41a7a24661db8ea374e2d25a4`.

All three are ancestors of the current integration base.

## Joint behavior proved

The installed-synthetic scenario uses two actual extension workers, production
HTTP transfer routes and a disposable API/PostgreSQL environment.

The recipient creates the request, its persistent browser context closes and
reopens on the same profile, then the source sends the encrypted packet. The
reopened recipient recovers the non-extractable P-256 private CryptoKey and
durable request metadata from IndexedDB.

Observed result:
- status PASS on Chromium `151.0.7922.34`;
- server request reaches `COMPLETED`;
- private key recovery is non-extractable;
- exactly one packet read;
- exactly one ACK POST;
- safe recovered result survives until explicit RESULT_CONSUME;
- later pending receive does not perform a second packet read or ACK;
- selected store revision is unchanged by replay;
- unselected store remains untouched;
- provider requests: 0;
- AI requests: 0.

The result is retained at `/tmp/a02-joint-restart-20260926/result.json`.
Supervisor `octoport-test-a-79f364f767aa441ab3743182524f8be2.service`
finished Result=success / ExecMainStatus=0 and is inactive/dead after cleanup.

## Evidence applicability to current main

The exact joint browser script SHA-256 on current base is
`ad6d1256fbc30cc081071ca6831731817cc32d9a5c4a4fb0b0972acc0d726040`,
matching the executed receipt.

Since A02, `packages/control-client/src/credential-transfer.js` has not changed.
Since B03, `apps/api/src/credential-transfer-routes.ts` and
`packages/server/credential-transfer/src/index.ts` have not changed.

The root dependency files are byte-identical:
- package.json SHA-256 `84b63aafdb9cc72203c2d2b4e90bae0ece1c5e90fa6d9a0d813ba5f7a567a6ed`;
- pnpm-lock.yaml SHA-256 `e947b55bf62341da18963663545d5fe91e243d83560d40e709a3361350ac34e5`.

Therefore repeating the unchanged heavy browser scenario would add no new
acceptance dimension.

## Boundary

This closes the A02+B03 combined restart/replay protocol acceptance required by
PLAN for the tested installed-synthetic Chromium environment.

It does not prove browser-profile destruction recovery, Firefox/Safari behavior,
LIVE_OWNER credentials, marketplace/provider traffic, production deployment or
store acceptance. Physical loss of the browser profile/IndexedDB after packet
availability remains truthfully unrecoverable under the unchanged protocol.
