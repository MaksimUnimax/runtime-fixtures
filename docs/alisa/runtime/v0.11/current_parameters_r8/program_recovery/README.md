# Program result recovery with the original request binding

## Problem and supported result

The R8 answer path refreshes current parameter values before it reconnects to an
already started program generation. The generation and its original fences stay
pinned, but the rebuilt document can contain different coefficients. The actual
program broker binds a result to all five fields: `job_id`, `user_id`, `messages`,
`document` and `model`. Sending the old generation key with a newly built document
therefore fails `Results.read` with `job_binding`. An otherwise retained completed
answer cannot be delivered to the existing fence and recovery can end as UNKNOWN.

This source change retains the original request identity before its first send.
A reconnect retrieves the completed answer using that identity. The existing
current-authority checks and R8 fence still decide whether the answer can be
published or must be durably discarded before another generation starts.

The baseline identities and observed producer source are recorded in
`BASELINE.json`. The native fixture archive, its manifest and the parent R8
`BASELINE.json` remain the original build inputs. `prepare_candidate.py` checks
those inputs before copying this complete canonical `model_program.py` into the
isolated native candidate. It no longer grows string substitutions for that
consumer. The other R8 integrations are unchanged.

## Persisted identity

For a new program attempt, the client records `_program_request_binding` with
exactly `job_id` and `fingerprint` in the same native transaction as
`_program_started`, before the first socket send. Both values are SHA256 hex
strings. The fingerprint uses the producer's existing canonical JSON binding of
the five request fields. No document, coefficient values or additional private
input snapshot is persisted.

On reconnect the client derives the expected job key again from the current
native tenant/job and the original persisted R8 generation. It checks the saved
key before connecting. It uses the saved fingerprint rather than hashing newly
refreshed input values. A malformed or foreign record fails closed.

The record is removed with the existing program fields when a fresh broker
attempt returns `busy`, or when the R8 fence durably discards a stale generation.
A completed native answer already clears progress through the existing commit.

The existing `prepare_answer` still runs before this client. If a current input
has become empty, that earlier stage may continue its existing coefficient-fill
path before reaching program recovery. This change does not reorder the whole
Worker step. The no-dispatch guarantee below applies to the protocol3 retrieval
pass; the principal regression changes a present coefficient to another value.

## Wire contract and producer behavior

Fresh execution continues to use the existing full protocol2 envelope. Its
acceptance, authority, executor and dispatch behavior are unchanged.

Recorded recovery uses this distinct envelope with no additional fields:

```json
{
  "protocol": 3,
  "job_id": "<original 64-character lowercase SHA256 key>",
  "fingerprint": "<original 64-character lowercase SHA256 binding>",
  "resume_only": true
}
```

The broker keeps the existing `SO_PEERCRED` check for `alice-market` and the same
lock and durable `Results` implementation. The protocol3 branch may read a saved
result, promote an already completed owned workspace using the existing recovery
path, deliver the result and accept its acknowledgement. It cannot enter the
fresh-work branch: it never calls `Results.start`, starts an executor or asks for
a model call. Missing, expired, acknowledged or incomplete results follow the
existing unavailable-result behavior. Recovery never falls back to fresh work.

A protocol3 completed reply has exactly these fields:

```json
{
  "kind": "complete",
  "job_id": "<requested original key>",
  "fingerprint": "<requested original binding>",
  "content": "<retained answer>",
  "digest": "<SHA256 of UTF-8 content>"
}
```

The consumer verifies the identity echo, content shape and digest before calling
the existing completion callback. A `call` message during any resumed operation
remains forbidden. The producer's existing complete-result TTL is 3600 seconds;
`program_results.py` is unchanged. Existing workspace promotion, compact ACK
tombstones and cleanup behavior are retained.

The callback must commit either the native answer or the stale-generation
discard before ACK. A callback exception sends no ACK. A lost ACK cannot undo
the committed action. ACK therefore means durable consumption or discard, not
necessarily READY.

## Legacy and deployment compatibility

A legacy `_program_started` record without the new binding uses its existing
protocol2 `resume_only=true` request. It does not invent an original fingerprint
from today's inputs. The old producer either confirms that binding or refuses
it; no legacy failure becomes permission to start work again. A failed protocol3
request has no protocol2 or fresh-execution fallback.

The new broker accepts existing protocol2 clients. Install and qualify the paired
broker revision before enabling the new consumer: an old broker does not accept
protocol3 recovery even though fresh protocol2 execution would still work. This
directory is source for that paired qualification, not a deployment command.
The socket unit, peer identity, worker, SDK, service limits and private stores are
outside this source delta.

The frozen R15 source closure, already built candidate and activation tool do not
automatically acquire this new build input. A later package must include and pin
the new consumer and qualify its compatible broker. This source change does not
alter the existing R15 candidate or establish INSTALLED_SYNTHETIC/LIVE_OWNER.

The prospective R15 builder now declares 97 source files. The existing activation
contract's 96-file source index and tool pins still qualify their frozen product
and package; they are not updated or weakened by this change. Activating a new
97-file candidate requires a fresh PLAN/package and a separately qualified
activation source index and tool pins.

## Focused qualification

Use the actual broker and `Results` code against disposable storage and a
synthetic completed answer. Reproduce a changed current document after the first
generation starts: protocol2 must expose the original binding conflict, while
protocol3 retrieves the original answer without any new executor/model/provider
dispatch. The original R8 fence must discard that stale answer before a later
generation can be admitted. For unchanged fences, the normal callback may commit
the recovered answer.

Check the persisted hashes before first send, foreign job/generation records,
wrong fingerprint, corrupt content/digest, missing/expired/acknowledged/started
results, a forbidden recovery `call`, revoked authority, callback/commit failure,
lost ACK, fresh `busy`, stale cleanup and legacy records without backfill. The
test suite must observe native commit or durable stale reschedule before ACK.
Testing may substitute disposable paths and fixture peer lookup; production
peer authentication remains mandatory.

No UNKNOWN state is rewritten, no new permission or table is introduced, and
individual live job outcomes are not inferred from this recovery improvement.
