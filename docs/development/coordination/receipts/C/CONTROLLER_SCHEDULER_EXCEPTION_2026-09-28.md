# Controller: ambiguous authenticated executor failure

Owner manual-mode task; only Health scheduler and its tests changed.
Base is controller explanation736300e8 on mainc08a0849.

Reproduced two unsafe retries: a synchronous throw and a rejected promise from
an authenticated-deep executor both became HEALTH_EXECUTOR_ERROR/retryable.
The synthetic executor counted two sends across two scheduler cycles. A generic
exception gives the scheduler no proof that the first send did not happen.
The fallback now uses existing SEND_UNCERTAIN terminal classification for this
layer. It does not retry that slot. NO_SESSION keeps its existing bounded retry.
Existing explicit pre-send failure results retain their normal classification.
This is a conservative uncertainty fence, not a new database state or schema.

Also reproduced retained deadline timers after success, failure and rejection.
The scheduler now clears only its own deadline timer when execution settles.
Late executor completion and existing persisted-result reconciliation are unchanged.

Verification: all five new cases failed before the fix; Health139/139 plus
Telegram93/93 =232/232 source tests pass after it, including existing timeout,
persisted-result recovery and ordinary public retry cases. Two typechecks and
changed-file lint/format/diff pass. Supervisor3cfc8a5596bd4057b5ab8767ac2e34cf
exited0, peak867 MiB, OOM0, cleanup verified. No real provider request, DB mutation
or live deployment ran. Logs: /root/octoport-control/logs/controller/manual-monitor-explanation-20260928/.
C takes the bounded patch through normal intake before authenticated live wiring.
