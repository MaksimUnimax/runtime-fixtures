# C07 Chrome 0.2.13 7d12 canonical successor R1

Task: `C07-CHROME0213-7D12-RELEASE-CANONICAL-SUCCESSOR-R1-20261006`

Base: `e44a2b5bd724f231cd6bb478074624c6534adc1f`

Evidence level: **SOURCE_CANONICAL_INPUT + exact retained package byte identity**. This receipt does not authorize catalog mutation, package build, ordinary authentication, LIVE_OWNER, deployment, or production.

## Exact repaired Chrome identity

- version: `0.2.13`
- source head: `087eab3394aac5164e8b3d16459eabf0697895d9`
- source tree: `7c72525e6e91c2ddda65e5d8ca0226846c04ae66`
- Chrome artifact: `Octoport-Chrome-0.2.13-test-7d12ddcb.zip`
- bytes: `2300829`
- SHA-256: `7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4`

The retained archive was read back from the controller artifact allocation and its size/SHA-256 match the identity above.

## Browser-specific mapping

The existing frozen `STORE_0_2_13_RELEASE_CANONICAL_INPUTS_V1` remains historical authority and is not rewritten.

The additive repaired-Chrome successor maps:

- Chrome -> `7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4`
- Opera -> `8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463`
- Yandex Chromium -> `8d0664dda71e5b1f12e4bd69e42b53325ee8d213eb6d4869d7291799fce5b463`
- Firefox -> `b987ce3a24258d3922f61b2d650c17ef029d895a25aab0ec6d27cccacec3c037`

This prevents the repaired Chrome digest from being silently propagated to Opera or Yandex.

## Focused verification

Node: `24.20.0`.

- `beta-release-canonical-inputs.test.ts`: 8/8 PASS.
- `store-multibrowser-successor-preflight.test.ts`: 19/19 PASS.
- Prettier check: PASS.
- ESLint on the four changed TypeScript files: PASS.
- `git diff --check`: PASS.
- Exact retained Chrome package size/SHA-256 readback: PASS.

The initial test attempt under system Node 22 did not collect tests because a fresh worktree had no workspace dependency links. It is environment/setup evidence only, not a product failure. The valid focused results above were run under project Node 24.20.0 using existing read-only workspace dependency links; no dependency installation was performed.

## Remaining gates

Independent gpt-6-luna read-only review is required before source publication. Main publication still requires fresh-base candidate handling and all five exact-SHA CI. Live catalog/policy mutation remains a distinct authority gate owned by the active evidence task; ordinary login/Start/Finish, LIVE_OWNER useful flow, exact d730 owner-test deployment, migration 58 application, and production remain unaccepted by this result.
