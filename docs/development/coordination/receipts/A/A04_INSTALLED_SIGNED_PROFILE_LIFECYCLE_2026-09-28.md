# A04 — installed signed-profile lifecycle — 2026-09-28

Status: **FIREFOX INSTALLED_SYNTHETIC PASS / OPERA INSTALLED OPEN**.

Task: `A_AUTO_PROFILE_INSTALLED_LIFECYCLE` (A04).
Test-only implementation commit: `850737e1`.
Fresh-main merge checkpoint: `ab27fb10c4d05f9acf97aba452d43490962f2569`.

## Firefox installed acceptance

Exact post-merge evidence:
`/root/octoport-control/logs/A/profile-installed-firefox-ab27fb10-r1/summary.json`.

Result:
- acceptance class: `INSTALLED_SYNTHETIC_FIREFOX_SIGNED_PROFILE_LIFECYCLE`;
- Firefox `155.0.1`;
- generated LOCAL_DEVELOPMENT carrier version `0.2.6`;
- carrier SHA-256 `04f9b0a703164675938f741115b827f2fe38293bd57d73dd6068b84cf98e3b9d`;
- add-on installed through the existing GeckoDriver `install_addon(..., temporary=True)` path;
- optional technical permission remained neutral/absent;
- live provider calls `0`;
- proxy upstream connections `0`.

Lifecycle proof:
- signed profile revision 1 applied with packaged composer behavior;
- signed revision 2 changed packaged behavior and stale revision-1 fence was rejected;
- revision 3 was deferred while Work was active, with no hot switch;
- after Finish, revision 3 applied through a fresh ensure;
- signed rollback to revision 1 applied;
- navigation could not resurrect the stale revision-3 identity;
- extension worker restart restored only the current signed profile;
- local revocation plus worker restart did not resurrect authority/profile;
- provider request count remained `0`.

Resource receipt:
`/root/octoport-control/resource-jobs/b8fb4ba19a2947ca9c98528a0ba0b88c/receipt.json`.
Supervisor exit `0`, OOM kills `0`, cleanup verified, peak `1795162112` bytes.

The unchanged ordinary installed Firefox functional matrix was also rerun on the same merged HEAD:
`/root/octoport-control/logs/A/profile-installed-firefox-normal-ab27fb10-r1-wrapper.log`.
It PASSed with the real extension action popup, active ChatGPT-tab binding, one synthetic WB
`seller_info` execution and one synthetic Ozon `roles` execution, no replay, and explicit Finish.
Those marketplace responses were local fixture responses; upstream connections and live provider calls remained `0`.
Resource job `70fab755bfa246d39645c8c078d4ae05`: exit `0`, OOM `0`, cleanup verified.

The implementation is test-only:
`api-harness.ts`, `firefox-functional-harness.py`,
`firefox-functional-run.py`, and `firefox_profile_lifecycle.py`.
The mutable profile control is fixture-only and opt-in; default fixture behavior remains unchanged.
No extension runtime, control-client, marketplace/provider, shared contract, DB schema, or production path changed.

## Opera installed boundary

Opera `136.0.6008.22` controlled-MV3 remains proven, but installed acceptance is **OPEN**.
A persistence preflight loaded extension version `0.2.6` into a disposable Opera persistent profile
through `--load-extension`, closed Opera, and relaunched the same profile without any extension
startup flags. The second launch had:
- persisted worker: `false`;
- persisted popup: `false`;
- service-worker count: `0`.

Evidence:
`/root/octoport-control/logs/A/opera-load-persistence-preflight.log`.
Therefore the command-line unpacked path is not promoted to installed acceptance.

The current execution channel could read Opera's internal extensions manager but did not provide an
accepted automated `Load unpacked` installation action. No browser state was modified to bypass that
gate. A separate genuine Opera persistent-install proof is still required before claiming
`INSTALLED_SYNTHETIC_OPERA`.

## Evidence boundary

This closes the explicit installed signed-profile lifecycle gap for Firefox only.
It does not establish LIVE_OWNER, live ChatGPT/provider behavior, STORE/AMO publication,
Opera store/developer persistent installation, deployment, or production assignment.
