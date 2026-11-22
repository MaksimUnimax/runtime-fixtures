"""Durable scheduled runs. Execution, publication and Telegram delivery have separate receipts."""
import asyncio
import fcntl
import json
import logging
import time
from pathlib import Path
from uuid import uuid4
from starlette.exceptions import HTTPException

from ...chat_worker import WorkerError
from ...storage import Scope
from ...telegram_api import DeliveryError
from . import recipe, schedule, store
from .recipe import PlanError


SCHEMA = (
    """CREATE TABLE IF NOT EXISTS timer_runs(
        id TEXT PRIMARY KEY, event TEXT NOT NULL REFERENCES timer_events(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, due INTEGER NOT NULL, started INTEGER, finished INTEGER,
        state TEXT NOT NULL, write_args TEXT, outcome TEXT, message TEXT, chat_delivery TEXT,
        telegram_delivery TEXT, retry_at INTEGER NOT NULL DEFAULT 0,
        UNIQUE(event,revision,due))""",
    "CREATE INDEX IF NOT EXISTS timer_run_queue ON timer_runs(state,due)",
    "CREATE INDEX IF NOT EXISTS timer_run_delivery ON timer_runs(chat_delivery,telegram_delivery,retry_at)",
    """CREATE TABLE IF NOT EXISTS timer_conditions(
        event TEXT PRIMARY KEY REFERENCES timer_events(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, matched INTEGER NOT NULL)""",
)


def now_us():
    return time.time_ns() // 1000


def verify_write(db, scope, run, args):
    # Runs inside the source process, immediately before invoking the authorized edit tool.
    store.require_plugin(db,scope)
    row = db.execute("""SELECT r.write_args FROM timer_runs r JOIN timer_events e ON e.id=r.event
        WHERE r.id=? AND e.workspace=? AND e.chat=? AND e.revision=r.revision AND e.status='active'
        AND r.state='prepared'""",(run,scope.workspace_id,scope.chat_id)).fetchone()
    if not row or json.loads(row[0]) != args:
        raise PlanError("Разрешение на это действие уже использовано или изменилось.")
    db.execute("UPDATE timer_runs SET state='writing' WHERE id=?", (run,))


def materialize(db, now, batch=64):
    # Produce one occurrence per eligible event per pass. Pending work is stored durably.
    rows = db.execute("""SELECT id,revision,next_us,schedule,anchor_us FROM timer_events
        WHERE status='active' AND next_us<=? AND NOT EXISTS(
        SELECT 1 FROM timer_runs WHERE event=timer_events.id AND state IN ('queued','reading','prepared','writing','dispatching'))
        ORDER BY next_us,id LIMIT ?""",(now,batch)).fetchall()
    for event,revision,due,rule,anchor in rows:
        upcoming = schedule.next_after(json.loads(rule),due,anchor)
        db.execute("INSERT INTO timer_runs(id,event,revision,due,state) VALUES(?,?,?,?,'queued')",
                   (uuid4().hex,event,revision,due))
        db.execute("UPDATE timer_events SET next_us=? WHERE id=?",(upcoming,event))
    return len(rows)


def current(db, run, scope):
    row = db.execute("SELECT event,revision FROM timer_runs WHERE id=?",(run,)).fetchone()
    if row is None:
        raise PlanError("Событие удалено.")
    event = store.event(db,scope,row[0])
    if event["status"]!="active" or event["revision"]!=row[1]:
        raise PlanError("Таймер приостановлен или его параметры изменились.")
    return event


class Scheduler:
    def __init__(self,state,runtime):
        self.state,self.runtime = state,runtime
        self.wake = asyncio.Event()
        self.tasks = {}
        self.lock = None
        self.loop = asyncio.create_task(self.serve())

    async def close(self):
        self.loop.cancel()
        await asyncio.gather(self.loop,return_exceptions=True)
        jobs = list(self.tasks.values())
        for task in jobs:
            task.cancel()
        await asyncio.gather(*jobs,return_exceptions=True)
        if self.lock:
            self.lock.close()

    async def serve(self):
        identity = self.state.identity
        lock_path = str(Path(self.state.worker.database_path).resolve())+".timer.lock"
        lock = open(lock_path,"a")
        self.lock = lock
        while True:
            try:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                break
            except BlockingIOError:
                await asyncio.sleep(1)
        with identity._write() as db:
            # Only the elected process performs recovery. In-flight writes cannot be resent.
            db.execute("""UPDATE timer_events SET status='paused',next_us=NULL WHERE id IN
                        (SELECT event FROM timer_runs WHERE state IN ('writing','dispatching'))""")
            db.execute("""UPDATE timer_runs SET message=CASE WHEN state IN ('writing','dispatching') THEN
                       'Сервис перезапустился во время записи. Исход нужно сверить с площадкой. Таймер на паузе.'
                       ELSE 'Сервис перезапустился до завершения проверки.' END,
                       outcome=CASE WHEN state IN ('writing','dispatching') THEN 'unknown' ELSE 'error' END,
                       state='done',finished=?,chat_delivery='pending',
                       telegram_delivery=CASE WHEN (SELECT json_extract(plan,'$.telegram') FROM timer_events
                       WHERE id=timer_runs.event)=1 THEN 'pending' ELSE 'off' END
                       WHERE state IN ('reading','prepared','writing','dispatching')""",(now_us(),))
            db.execute("UPDATE timer_runs SET telegram_delivery='unknown' WHERE telegram_delivery='sending'")
        while True:
            self.wake.clear()
            try:
                with identity._write() as db:
                    materialize(db,now_us())
                    pending = db.execute("""SELECT r.id,w.owner_id,e.workspace,e.chat,r.due FROM timer_runs r
                        JOIN timer_events e ON e.id=r.event JOIN workspaces w ON w.workspace_id=e.workspace
                        WHERE r.state='queued' ORDER BY r.due LIMIT 64""").fetchall()
                for run,actor,workspace,chat,due in pending:
                    if len(self.tasks)>=6:
                        break
                    if chat in self.tasks:
                        continue
                    task = asyncio.create_task(self.execute(run,Scope(actor,workspace,chat),due))
                    self.tasks[chat] = task
                    task.add_done_callback(lambda done,c=chat:self.done(c,done))
                await self.deliver()
            except asyncio.CancelledError:
                raise
            except Exception:
                logging.getLogger(__name__).exception("Timer queue iteration failed")
            try:
                await asyncio.wait_for(self.wake.wait(),.5)
            except TimeoutError:
                pass

    def done(self, chat, task):
        self.tasks.pop(chat,None)
        if not task.cancelled() and task.exception():
            logging.getLogger(__name__).error("Timer run failed (%s)",type(task.exception()).__name__)
        self.wake.set()

    async def execute(self, run, scope, due):
        identity = self.state.identity
        with identity._write() as db:
            try:
                event = current(db,run,scope)
            except (HTTPException,PlanError):
                db.execute("UPDATE timer_runs SET state='cancelled',finished=? WHERE id=?",(now_us(),run))
                return
            if not db.execute("UPDATE timer_runs SET state='reading',started=? WHERE id=? AND state='queued'",
                              (now_us(),run)).rowcount:
                return
        plan = event["plan"]
        local = recipe.local_time(due,event["schedule"])
        question = "\n".join(event["instructions"])
        key = "timer.run."+run
        matched = None
        try:
            async with self.runtime.operation(scope,key) as grant:
                facts = await self.runtime.read(scope,grant,key,question,plan["steps"],local)
                outcome, text = "report", ""
                if event["kind"]=="action":
                    if any(isinstance(v,dict) and v.get("error") for v in facts):
                        raise PlanError("Обязательный источник не подтвердил данные. "+str(facts))
                    a = plan["action"]
                    matched, args, detail = recipe.decision(a,facts)
                    with identity._write() as db:
                        current(db,run,scope)
                        prior = db.execute("SELECT matched FROM timer_conditions WHERE event=? AND revision=?",
                                           (event["id"],event["revision"])).fetchone()
                        if a["mode"]=="edge" and prior==(1,):
                            args = None
                            if matched:
                                detail = "Условие продолжает выполняться после предыдущего срабатывания."
                        if args is not None:
                            payload = {"action":"edit","connectionId":a["connectionId"],
                                       "templateId":a["templateId"],"params":args}
                            db.execute("UPDATE timer_runs SET state='prepared',write_args=? WHERE id=?",
                                       (store.encoded(payload),run))
                    if args is None:
                        outcome,text = "skip",detail
                    else:
                        result = await self.runtime.source(scope,grant,key,a["command"],"write",
                                                           "marketplace_read",payload,run)
                        state = result.get("state")
                        text = str(result.get("result") or result.get("reason") or result.get("message") or state)
                        if state=="accepted" and result.get("ok"):
                            reached = False
                            if a.get("stopAtBound") and (adjust := a.get("adjust")):
                                limit = adjust["min"] if recipe.numeric(adjust["by"])<0 else adjust["max"]
                                reached = recipe.numeric(args[adjust["field"]])==recipe.numeric(limit)
                            outcome = "goal" if a["mode"]=="once" or reached else "changed"
                            text = detail+" "+text
                        elif state in ("refused","cancelled"):
                            outcome = "error"
                        else:
                            outcome = "unknown"
                            text = "Таймер приостановлен для сверки. "+text
                    # Preserve the provider receipt even if the model is unavailable afterwards.
                    try:
                        observation = await self.runtime.render(grant,plan,facts)
                    except Exception:
                        observation = "Проверенные данные: "+store.encoded(facts)
                    text = observation+"\n"+text+"\nПроверка: "+local.isoformat()
                else:
                    text = await self.runtime.render(grant,plan,facts)
                    if any(isinstance(v,dict) and v.get("error") for v in facts):
                        outcome = "error"
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            with identity._lock:
                row = identity._db.execute("SELECT state FROM timer_runs WHERE id=?",(run,)).fetchone()
            outcome = "unknown" if row in (("writing",),("dispatching",)) else "error"
            text = (str(exc) if isinstance(exc,PlanError) else "Сервис не подтвердил выполнение поручения.")
            if outcome=="unknown":
                text += " Исход записи требует сверки. Таймер приостановлен."
        with identity._write() as db:
            if not db.execute("SELECT 1 FROM timer_runs WHERE id=?",(run,)).fetchone():
                return
            if outcome=="unknown":
                db.execute("UPDATE timer_events SET status='paused',next_us=NULL WHERE id=?",(event["id"],))
            elif outcome=="goal" or event["next_us"] is None:
                db.execute("""UPDATE timer_events SET status='completed',next_us=NULL WHERE id=? AND revision=?
                           AND status='active'""",(event["id"],event["revision"]))
            if matched is not None and outcome not in ("unknown","error"):
                db.execute("INSERT OR REPLACE INTO timer_conditions VALUES(?,?,?)",
                           (event["id"],event["revision"],int(matched)))
            notify = (plan["notify"]=="all" or outcome in ("error","unknown")
                      or plan["notify"]=="changes" and outcome in ("changed","goal")
                      or plan["notify"]=="goal" and outcome=="goal")
            db.execute("""UPDATE timer_runs SET state='done',finished=?,outcome=?,message=?,chat_delivery=?,
                       telegram_delivery=? WHERE id=?""",(now_us(),outcome,text,"pending" if notify else "off",
                       "pending" if notify and plan["telegram"] else "off",run))

    async def deliver(self):
        identity = self.state.identity
        with identity._lock:
            rows = identity._db.execute("""SELECT r.id,w.owner_id,e.workspace,e.chat,r.message,r.chat_delivery,
                r.telegram_delivery FROM timer_runs r JOIN timer_events e ON e.id=r.event
                JOIN workspaces w ON w.workspace_id=e.workspace WHERE r.state='done' AND r.retry_at<=unixepoch()
                AND (r.chat_delivery='pending' OR r.telegram_delivery='pending') ORDER BY r.due LIMIT 16""").fetchall()
        for run,actor,ws,chat,text,chat_state,tg in rows:
            scope = Scope(actor,ws,chat)
            if chat_state=="pending":
                try:
                    await self.state.worker.request(scope,"timerExchange",requestId="timer."+run,text="",answer=text)
                except WorkerError:
                    with identity._write() as db:
                        db.execute("UPDATE timer_runs SET retry_at=unixepoch()+5 WHERE id=?",(run,))
                    continue
                with identity._write() as db:
                    db.execute("UPDATE timer_runs SET chat_delivery='sent',retry_at=0 WHERE id=?",(run,))
            if tg=="pending":
                with identity._write() as db:
                    if not db.execute("""UPDATE timer_runs SET telegram_delivery='sending'
                        WHERE id=? AND telegram_delivery='pending'""",(run,)).rowcount:
                        continue
                status,delay = "sent",0
                try:
                    await self.state.telegram.send(ws,text)
                except DeliveryError as exc:
                    status = "pending" if exc.status=="limited" else exc.status
                    delay = exc.delay
                except Exception:
                    status = "unknown"
                with identity._write() as db:
                    db.execute("UPDATE timer_runs SET telegram_delivery=?,retry_at=unixepoch()+? WHERE id=?",
                               (status,delay,run))
