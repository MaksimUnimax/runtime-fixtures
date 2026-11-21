# Direct customer login — installed evidence

Product source: `3a1d3885250d8aa1a51f6e7df3f9d1c3db50b281`. Installed Identity overlay: `alisa-direct-login-3a1d3885250d8aa1`. The three changed product files were checked against the exact qualified CI package and immutable active baseline. Other Identity material and dependencies are referenced unchanged.

`source-review-r2.json` binds the final five-file product/test delta. `install-review.json` binds the Identity-only installer. `resume-review.json` covers only the named native-core/checker restart that another actor completed between prepare and activation. Earlier lock contention performed no mutation and is recorded separately. The original private snapshot is retained on Alisa and is not published.

`browser-review.json` is the original unexecuted draft's HOLD for insufficient origin pinning. `browser-review-r2.json` binds the corrected executed script. The public-browser test uses only an existing own reserved fixture, a new empty browser, native password and two genuinely delivered sandbox email codes. It never accesses an owner session or writes directly to the database. Password/code/cookies/private state and client identifiers are excluded from this directory. Native authentication itself creates its normal protocol records.

The browser's profile and caches lived in a private tmpfs RuntimeDirectory under a finite systemd unit. `browser-systemd-profile.json` records the loaded start profile as observed by the author; post-collection default properties are not evidence of loaded limits. Final memory peak was not captured. The passing browser receipt, final readiness, removed cgroup/RuntimeDirectory, and the separately retained exact public dependency cache bytes are recorded without claiming an owner-browser test.

These are scoped one-time execution procedures with fresh preconditions and receipts, not a runner or instructions for blind repeated execution. Previous releases, current auth/mail configuration, grants, connected store keys, and schema remain preserved. See [the final report](../AL_S02_DIRECT_LOGIN_20261108.md). AL-S06 discovery is recorded separately and is not marked implemented.
