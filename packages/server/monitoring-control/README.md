# Monitoring run ownership

The scheduler owns a lane until its lease expires, it is cancelled, or its
protected `finishRun` succeeds. A runner receives its cancellation signal and
run authority. Scheduler execution also establishes an async run context, so
API-watch stores can enforce ownership at their actual acceptance boundary.
The context is shared across bundled copies of this private workspace package;
its values remain isolated per async execution.

An AbortSignal is advisory cancellation, not permission to commit. In-memory
stores synchronously check the current owner and deadline immediately before
publishing mutations. PostgreSQL store factories fence their existing runtime:
the lane row is locked, PostgreSQL time is sampled after the lock, and the
application write uses the same connection and transaction. A fresh deadline
check before acceptance rolls back a write that completed too late. Missing or
replaced ownership revokes the run signal. The existing conditional, database
clock protected `finishRun` is retained.

Snapshot files are immutable content-addressed staging. Publication of accepted
snapshot/inventory metadata is fenced. A file write already in progress can
leave an unreferenced blob; it does not grant accepted snapshot authority and
is not removed speculatively, because another writer may use the same digest.

Incident notifications are admitted only while their originating run is
current. Scheduler result notifications require the matching accepted result
and no successor lease. Ownership is checked under the lane lock when an
external effect is initiated; the lock is released before awaiting transport.
Notification events carry their captured admission capability. A multi-recipient
consumer must use it immediately before **each** physical send, not just once
for the async notifier as a whole. The Telegram consumer does this at each
`sendMessage` (the HTTP fetch starts synchronously in that callback). Stopping
or replacing the runner while the first send is pending prevents later sends;
it cannot retract that first send. Merely passing the former lease timestamp
does not invalidate an already accepted result notification.
An already initiated external effect cannot be undone. An uncertain gate
completion after initiation is reported as unknown and is not automatically
sent again. Late notification failure accounting is conditional on the same
accepted run ID, so it cannot charge a successor.

`stop()` cancels active signals and conditionally releases this scheduler's
leases. It returns after lease cancellation, without waiting indefinitely for
an uncooperative transport. Work resumed afterwards cannot accept new records
or initiate another notification. Already committed results are preserved.
Subsequent explicit `start()` / `runNow()` calls create a new lifecycle.

The cancellation timer uses a process-local monotonic reservation deadline.
PostgreSQL samples its lease clock after the row lock; the local budget starts
at that clock request, includes response/commit latency, and excludes the
earlier row-lock wait. Absolute scheduler and database wall clocks are never
subtracted. This hint is not persisted and is not lease authority: the existing
PostgreSQL owner/time checks still decide durable acceptance. Legacy store
implementations without the hint receive a conservative request-time budget.

Standalone operator operations outside a scheduler execution retain their
existing authority and behaviour. No schema migration, daemon, provider call,
or deployment is introduced here.

Regression coverage includes two overlapping schedulers, delayed authority and
snapshot acceptance, stop during acquisition, SQL transaction rollback and
post-lock clock sampling, successor notification isolation, and the actual
built API-watch bundle consumed by a separately bundled scheduler. SQL tests
use transaction fixtures; they are not an installed PostgreSQL acceptance.

A rejected physical-send acknowledgement is a terminal unknown outcome for
that notification attempt; the scheduler does not replay it automatically.
Failure accounting is attempted once. Its uncertain commit acknowledgement
propagates without a second counter increment.
