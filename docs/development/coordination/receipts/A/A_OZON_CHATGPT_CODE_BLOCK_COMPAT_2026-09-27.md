# A — Ozon Bridge / current ChatGPT fenced-code compatibility

Owner request: keep the canonical Ozon Bridge repository current with the work performed in this incident.

Repository: `MaksimUnimax/runtime-fixtures`
Candidate branch: `fix/ozon-bridge-chatgpt-code-block-2026-09-27`
Base: `49cd4d41c66ff6465d2ea1c384b53fb07006b113`

## Change boundary

- Preserve the frozen imported Ozon v0.1.22 donor byte-for-byte.
- Apply ChatGPT DOM compatibility through `apps/extension/application-patches.json`.
- Recognize current `data-message-role`, `Copy code` / `data-code-copy-state`, and fenced `pre > code` surfaces.
- Preserve user-message exclusion and one-code-block ownership.
- Extend the existing native Chromium application fixture with the current ChatGPT fenced-code DOM shape.

Frozen donor `shared/ai_adapters.js` SHA-256:
`4b9423666cf7bed03f89edb3c23d535bd02143e85c1a1b7317d184f25cc1bb72`

Composed source and extracted `shared/ai_adapters.js` SHA-256:
`3e2939c677c87da21aabc71351d767fbbbcc28e4c8017a25765c09e5b288835f`

## Verification

Native Chromium application-browser source: PASS.
Native Chromium application-browser extracted package: PASS.
Both results include `current ChatGPT data-message-role fenced-code DOM`.
Live provider calls: 0.

The composed adapter bytes match the separately server-tested adapter bytes exactly.
This receipt does not claim that the owner's local browser incident is independently resolved; it records repository synchronization and bounded regression evidence only.
