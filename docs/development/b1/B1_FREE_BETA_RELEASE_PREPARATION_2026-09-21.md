# B1 free-beta release preparation — automated closure

Work ID: `B1-A-20260921-FREE-BETA-RELEASE-PREPARATION-AUTOMATED-CLOSURE`

This is release preparation only. No browser-store upload, legal acceptance,
billing enablement, production launch, SMTP/Exim change, Stream-2 change, or
Q1-C owner/live test was performed.

## Git and worktree

- Source worktree: `/root/runtime-fixtures-b1`
- Base accepted Q1-D HEAD: `151b06bf25b8ff6abb2e59c76518c4e615860851`
- Base accepted Q1-D tree: `d73179e73b797759398ca2992efa227bc1f6155d`
- Branch: `feature/b1-free-beta-release-preparation-2026-09-21`
- Final HEAD/tree: recorded in the terminal handoff after the bounded commit.
- The active SMTP/Exim worktree, owner handoff artifacts, Business Bridge, and
  Stream-2 implementation paths were not modified.

## Node 24 release parity

Exact runtime: Node `v24.20.0`; pnpm `10.34.5`.

- frozen offline install/lockfile consistency: PASS
- workspace typecheck: PASS
- lint and bridge guard: PASS
- API/worker/health-runner/portal/admin build: PASS
- workspace unit suite (`pnpm test`): PASS
- PostgreSQL integration: 40 files, 1,533 tests, PASS
- API unit: 18 files, 225 tests, PASS
- Portal unit: 36 tests, PASS
- Admin unit: 152 tests, PASS
- Compatibility/B1 release matrix: 7 tests, PASS
- Documentation check: PASS on the accepted source-of-truth line

The previous Node 22 warning is not used as B1 release evidence.

## Release-candidate identity

The committed [RC manifest](B1_RC_MANIFEST_2026-09-21.json) identifies one
candidate:

- ID: `seller-agents-free-beta-rc-2026-09-21`
- Product version: `0.2.4`
- Candidate source: Q1-D accepted HEAD/tree above
- Server contract: `control_plane_v1`
- Migration level: `18`
- Preprod trust ID: `octoport-preprod-2026-09-19`
- Trust fingerprint: `edc47821df296868c7061069ed50fa742f70a75889bd010dadef5166fadc4645`
- API: `https://api.octoport.ru`
- Portal: `https://app.octoport.ru`
- Production published: NO

The machine-readable preparer is
`tooling/b1/prepare-release-candidate.mjs`; the output was independently
checked by `tooling/b1/release-preflight.mjs`. It copies the already accepted
owner packages without changing them, records inventory and SHA-256, rejects
localhost endpoints, checks migration identity, and performs no deployment.

## Packages and browser truth

| Target | Package | Size | SHA-256 | Truth |
|---|---|---:|---|---|
| Chromium family | `SELLER_AGENTS_FREE_BETA_RC_0.2.4_CHROMIUM.zip` | 2,076,778 | `bfdb6f67b0abb7efd1f7892382e2b1c8c16c07c957e0567d247ef143091f61be` | Chrome manual follow-up; Opera bounded automated 24/24; Yandex package/runtime deferred |
| Firefox | `SELLER_AGENTS_FREE_BETA_RC_0.2.4_FIREFOX.zip` | 3,886,154 | `3db61719560acf27e29591efba3852d0df5e16a9328be813f1198082aee8a459` | package-ready; runtime environment deferred |
| Safari | none | — | — | macOS/Xcode environment deferred |

Both ZIPs passed integrity, manifest, inventory, and JavaScript syntax checks.
The Firefox carrier retains the existing `background.scripts`/Gecko packaging
boundary. Package availability does not change browser acceptance status.

## Onboarding and capacity

The deterministic onboarding state machine is:

`PORTAL → OTP_REQUEST/VERIFY → ACCOUNT → DEVICE_ACTIVATION → SIGNED_BOOTSTRAP
→ EXTENSION_AUTH → STORE_BINDING → FIRST_READ_ONLY_START`.

Fixture and server evidence for account/session/device/Bootstrap/store/Start is
green. The only deferred onboarding edge is real external OTP mailbox receipt,
because S1.2 still awaits AdminVPS TCP/25, PTR, DKIM/DMARC publication, and
the legitimate owner mailbox test. No console/database/test-mailbox shortcut
was used.

The beta-capacity procedure is ready in the operational runbook below and uses
the accepted Q1-D server controls: inspect current state, apply an idempotent
admin request with a request ID, verify the audit record, preserve admitted
users, and use the emergency freeze without deleting accounts or credentials.
No monetization or billing path is enabled.

## Compatibility matrix

The release matrix test covers:

| Case | Result |
|---|---|
| Supported `0.2.4` / supported contract/browser | `SUPPORTED` |
| Too-old `0.2.3` | `UPDATE_REQUIRED` |
| Blocked version | `UPDATE_REQUIRED` |
| Newer `0.2.5` with supported contract | forward-compatible `SUPPORTED` |
| Incompatible server contract | `UPDATE_REQUIRED` |
| Unknown Bootstrap trust ID | rejected by existing signed-envelope verifier |
| Migration mismatch | preflight guard refuses identity mismatch |

No mandatory per-command server call was added. The server contract and trust
identity remain unchanged.

## Upgrade, deployment, and rollback

The current accepted package was copied byte-for-byte into the RC staging
directory. C3H restart/local-state tests preserve account binding, stores,
labels, pending sync metadata, Work lifecycle state, and privacy fences. The
application smoke passed C3A 4/4. The C3H functional sequence passed AUT-01
through AUT-46 and AUT-48 through AUT-50; AUT-47 remains the already-known
native MV3 browser environment defer.

The [deployment checklist](B1_DEPLOYMENT_CHECKLIST_2026-09-21.md) covers
precheck, build, artifact verification, backup, migration, API/portal deploy,
health, Bootstrap/package compatibility, and rollback decision. Rollback is to
an exact previous immutable API/portal revision and compatible extension
package; database rollback is forward-fix/restore, not destructive downgrade.
Bootstrap key rotation requires overlap before cutover and retains the old key
while rollback is possible.

## Support diagnostics and error taxonomy

The [installation guide](B1_INSTALLATION_GUIDE_2026-09-21.md) provides the
user-facing safe report procedure. Allowed fields are app/browser/extension
versions, safe error class, request ID, timestamp, capability state, and safe
account/device IDs. OTPs, cookies, storageState, marketplace tokens, raw
reports, AI bodies, transfer packets, and backup passwords are forbidden.

Stable beta support classes:

| Class | Support code | User message class | Retry | Safe action |
|---|---|---|---|---|
| Authentication | `AUTH` | Sign in again | Sometimes | Reopen login |
| OTP | `OTP` | Code unavailable/expired | Request new code under cooldown | Use real mailbox |
| Bootstrap | `BOOTSTRAP` | Secure setup unavailable | Bounded retry | Do not bypass trust |
| Store credential | `STORE_CREDENTIAL` | Store needs attention | No automatic replay | Re-enter locally |
| Provider rate limit | `PROVIDER_429` | Provider is rate-limiting | Retry after provider delay | Wait; no burst |
| Provider unknown | `PROVIDER_UNKNOWN` | Result is not confirmed | No automatic replay | Review safely |
| AI composer | `AI_COMPOSER` | Supported conversation required | No blind retry | Select supported AI |
| Delivery unknown | `DELIVERY_UNKNOWN` | Delivery not confirmed | No replay | Inspect local state |
| Sync | `SYNC` | Sync is pending/conflicted | Bounded retry | Continue another local action |
| Transfer | `TRANSFER` | Transfer unavailable | No automatic replay | Use explicit flow |
| Backup | `BACKUP` | Backup operation failed | Bounded retry | Verify local file |
| Browser compatibility | `BROWSER_COMPAT` | Browser/package not verified | No | Use verified route |
| Server unavailable | `SERVER_UNAVAILABLE` | Service unavailable | Bounded retry | Check status later |
| Version incompatible | `VERSION_INCOMPATIBLE` | Update required | No | Install exact RC/update |

No stack traces are user-facing and no hidden telemetry archive was added.

## Release notes and publisher preparation

The concise [release notes](B1_RELEASE_NOTES_2026-09-21.md), installation guide,
and [publisher metadata](B1_PUBLISHER_METADATA_2026-09-21.md) are ready. They
state the narrow browser truth, read/report scope, local credential boundary,
known OTP/browser/live limitations, and no production-release claim.

Publisher metadata is preparation only: no store account, agreement, upload,
or publication occurred. Privacy-policy URL remains an explicit owner input;
no unverified URL was invented.

## Privacy/security gate

- RC client ZIPs: no private signing key, DB URL, SMTP credential, or signing
  secret found.
- Server-only configuration names remain server-only; no secret value entered a
  client artifact.
- Existing OTP log/privacy tests and Q1-D diagnostics evidence remain green.
- No raw seller reports or marketplace credentials are durable server data.
- No transfer ciphertext or backup plaintext/password is server-persisted.
- No hidden mandatory control-plane proxy path was introduced.

## External gates intentionally not executed

- S1.2: AdminVPS outbound TCP/25 unblock, PTR, DKIM/DMARC DNS, real mailbox
  OTP receipt.
- Q1-C: real owner AI sessions, Ozon/WB credentials/rights, and live owner UX.
- Browser: Chrome manual, Yandex manual, Firefox manual, Safari real Mac.
- Publisher accounts, legal agreements, paid actions, store upload, and final
  production cutover.

## Candidate disposition

Automated B1 preparation is complete. Real external OTP, owner/live, browser
environment, publication, and legal gates remain truthful deferrals. This
receipt recommends `B1_AUTOMATED_RELEASE_PREP_PARTIAL_EXTERNAL_GATES`; it is
not B1 release acceptance. The next independent Stream-1 task is the owner/live
Q1-C session after SMTP external actions, not production publication.
