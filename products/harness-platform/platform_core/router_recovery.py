"""Resume only model calls for which OpenRouter explicitly reported no generation."""
import asyncio
import contextlib
import fcntl
import hashlib
import json
from pathlib import Path
import time

from . import chat_connections, coins
from .operation_grants import active_chat_grant
from .storage import Scope
from .user_plugins.registry import attached, ILLUSTRATIONS, plugin_statuses
from cryptography.exceptions import InvalidTag

SCHEMA = """CREATE TABLE IF NOT EXISTS openrouter_waits (
    attempt TEXT PRIMARY KEY REFERENCES coin_attempts(attempt_id) ON DELETE CASCADE,
    session_digest BLOB NOT NULL, retry_at REAL NOT NULL, checkpoint TEXT NOT NULL,
    payload TEXT NOT NULL, resume_owner TEXT)"""

@contextlib.contextmanager
def ownership(database, attempt):
    # The kernel releases this host-local lease even when the owner is killed.
    directory=Path(database).resolve().parent/'openrouter-leases'
    directory.mkdir(mode=0o700,exist_ok=True)
    # Serialize filename creation and removal. Nobody can retain an unlinked inode
    # and acquire its lock after a replacement file has been created.
    path = directory / hashlib.sha256(attempt.encode()).hexdigest()
    with (directory / '.directory-lock').open('a+b') as registry:
        fcntl.flock(registry, fcntl.LOCK_EX)
        lock = path.open('a+b')
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except BlockingIOError:
                acquired = False
        finally:
            fcntl.flock(registry, fcntl.LOCK_UN)
        try:
            yield acquired
        finally:
            if acquired:
                fcntl.flock(registry, fcntl.LOCK_EX)
                try:
                    lock.close()
                    path.unlink(missing_ok=True)
                finally:
                    fcntl.flock(registry, fcntl.LOCK_UN)
            else:
                lock.close()


def claim(router, aid, grant):
    digest = hashlib.sha256(grant.token.encode()).hexdigest()
    with router.identity._write() as db:
        return bool(db.execute("""UPDATE openrouter_waits SET resume_owner=? WHERE attempt=?
            AND EXISTS (SELECT 1 FROM coin_attempts WHERE attempt_id=? AND operation_id=?)
            AND EXISTS (SELECT 1 FROM marketplace_retry_windows WHERE token_hash=? AND session_digest=openrouter_waits.session_digest)""",
            (digest, aid, aid, grant.operation_id, digest)).rowcount)


def valid_file_ids(ids):
    from .chat_attachments import validate_ids
    from starlette.exceptions import HTTPException
    try:
        validate_ids(ids)
    except HTTPException:
        return False
    return True


def valid_checkpoint(value):
    if not isinstance(value, dict) or set(value) - {"attachments"} != {
        "text", "baseRevision", "priorCalls", "events", "connections", "illustrations", "availableServices", "connectionGuides"
    }:
        return False
    return (isinstance(value["text"], str) and len(value["text"].encode()) <= 8192
            and (bool(value["text"]) or bool(value.get("attachments")))
            and ("attachments" not in value or valid_file_ids(value["attachments"]))
            and all(type(value[k]) is int and value[k] >= 0 for k in ("baseRevision", "priorCalls"))
            and all(isinstance(value[k], list) and all(isinstance(r, dict) for r in value[k])
                    for k in ("events", "connections", "availableServices"))
            and type(value["illustrations"]) is bool and isinstance(value["connectionGuides"], dict))


def park(router,token,aid,checkpoint,payload,delay):
    if checkpoint is None:
        return
    digest=hashlib.sha256(token.encode()).hexdigest()
    with router.identity._write() as db:
        return bool(db.execute("""INSERT OR REPLACE INTO openrouter_waits(attempt,session_digest,retry_at,checkpoint,payload)
            SELECT ?,r.session_digest,?,?,? FROM marketplace_retry_windows r JOIN usage_grants g USING(token_hash)
            JOIN coin_attempts a USING(operation_id) WHERE g.token_hash=? AND a.attempt_id=? AND r.session_digest IS NOT NULL""",
            (aid,time.time()+delay,json.dumps(checkpoint,ensure_ascii=False),json.dumps(payload,ensure_ascii=False),digest,aid)).rowcount)

def close_rejected(router,aid):
    # Only a still-parked attempt has positive evidence that no generation was accepted.
    with router.identity._write() as db:
        if db.execute("DELETE FROM openrouter_waits WHERE attempt=?",(aid,)).rowcount:
            db.execute("UPDATE coin_attempts SET charge=0,evidence='openrouter-usd:0' WHERE attempt_id=? AND charge IS NULL",(aid,))
            db.execute("""INSERT OR IGNORE INTO openrouter_stopped_outputs SELECT i.id
                FROM plugin_illustrations i JOIN coin_attempts a USING(operation_id)
                WHERE a.attempt_id=? AND i.content IS NOT NULL""",(aid,))
            coins.close_orders(db)

def authorization(db,scope,checkpoint,session):
    if not db.execute("SELECT 1 FROM identity_sessions WHERE digest=? AND actor_id=? AND expires_at>unixepoch()",
                      (session,scope.actor_id)).fetchone():
        return False
    try:
        connections=[r for r in chat_connections.snapshot(db,scope) if r['attached']]
    except (ValueError,KeyError,PermissionError,InvalidTag):
        return False
    return connections==checkpoint['connections'] and bool(attached(db,scope,ILLUSTRATIONS.id))==checkpoint['illustrations']

def read_parked(router,token,aid, *, owner=False, consume=False):
    digest=hashlib.sha256(token.encode()).hexdigest()
    with router.identity._write() as db:
        row=db.execute("""SELECT o.workspace_id,w.payload,w.retry_at,o.actor_id,o.chat_id,w.checkpoint,w.session_digest,w.resume_owner
          FROM openrouter_waits w JOIN coin_attempts a ON a.attempt_id=w.attempt JOIN usage_operations o USING(operation_id)
          JOIN usage_grants g USING(operation_id) JOIN marketplace_retry_windows r USING(token_hash)
          WHERE w.attempt=? AND g.token_hash=? AND w.session_digest=r.session_digest AND a.charge IS NULL""",(aid,digest)).fetchone()
        if not row or (owner and row[7] != digest) or not active_chat_grant(db,digest) or not authorization(db,Scope(row[3],row[0],row[4]),json.loads(row[5]),row[6]):
            return None
        if db.execute("""SELECT 1 FROM coin_attempts WHERE attempt_id=? AND bound>0 AND NOT EXISTS
            (SELECT 1 FROM workspace_paid_model_access WHERE workspace_id=?)""",(aid,row[0])).fetchone():
            return None
        if consume:
            db.execute("DELETE FROM openrouter_waits WHERE attempt=?", (aid,))
        return row[0],json.loads(row[1]),max(0,row[2]-time.time())

class Recovery:
    def __init__(self,router,worker):
        self.router,self.worker=router,worker
        self.tasks={}

    async def run(self):
        try:
            while True:
                with self.router.identity._lock:
                    rows=self.router.identity._db.execute("SELECT attempt FROM openrouter_waits ORDER BY retry_at").fetchall()
                for (aid,) in rows:
                    if aid not in self.tasks:
                        self.tasks[aid]=asyncio.create_task(self.resume(aid))
                await asyncio.sleep(.5)
        finally:
            for task in tuple(self.tasks.values()):
                task.cancel()
            await asyncio.gather(*self.tasks.values(),return_exceptions=True)

    async def resume(self,aid):
        try:
            with ownership(self.router.database_path,aid) as acquired:
                if not acquired:
                    return
                with self.router.identity._lock:
                    db=self.router.identity._db
                    row=db.execute("""SELECT o.actor_id,o.workspace_id,o.chat_id,o.run_key,w.checkpoint,w.session_digest
                        FROM openrouter_waits w JOIN coin_attempts a ON a.attempt_id=w.attempt
                        JOIN usage_operations o USING(operation_id) WHERE w.attempt=? AND a.charge IS NULL""",(aid,)).fetchone()
                    if not row:
                        return
                    actor,workspace,chat,rid,raw,session=row
                    scope=Scope(actor,workspace,chat)
                    checkpoint=json.loads(raw)
                    allowed=authorization(db,scope,checkpoint,session)
                    if allowed:
                        statuses=plugin_statuses(db,workspace,chat)
                if not allowed:
                    close_rejected(self.router,aid)
                    return
                hub=self.router.progress
                live,owner=hub.begin(scope,rid)
                try:
                    await self.worker.request(scope,'turn',requestId=rid,text=checkpoint['text'],
                        attachments=checkpoint.get('attachments', []),
                        connections=checkpoint['connections'],illustrations=checkpoint['illustrations'],
                        availableServices=checkpoint['availableServices'],connectionGuides=checkpoint['connectionGuides'],
                        pluginStatuses=statuses,session_digest=session,on_progress=live.set,restore={**checkpoint,'attempt':aid})
                except (PermissionError,ValueError):
                    close_rejected(self.router,aid)
                except Exception as error:
                    from .chat_worker import WorkerError
                    if isinstance(error,WorkerError) and error.code in ('conflict','unavailable','turn_unconfirmed','model_wait_cancelled','payment_required','attachment_unavailable'):
                        close_rejected(self.router,aid)
                    # A worker/process failure leaves a still-confirmed wait available to the next owner.
                    await asyncio.sleep(1)
                finally:
                    if owner: hub.finish(scope,rid,live)
        finally:
            self.tasks.pop(aid,None)
