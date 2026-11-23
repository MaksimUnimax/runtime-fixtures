"""Both the plugin panel and ordinary chat turns enter the same preview/approval conversation."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
import fcntl
from pathlib import Path
import hashlib
import json
import re
from weakref import WeakValueDictionary
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from starlette.exceptions import HTTPException

from ...identity import _secret_digest
from ..registry import attached, plugin_statuses
from . import jobs, recipe, store
from .recipe import PlanError
from .runtime import Runtime


SCHEMA = (
    """CREATE TABLE IF NOT EXISTS timer_dialogs(
       chat TEXT PRIMARY KEY REFERENCES chats(chat_id) ON DELETE CASCADE, kind TEXT, target TEXT,
       zone TEXT NOT NULL, instructions TEXT NOT NULL, draft TEXT, shown TEXT)""",
    """CREATE TABLE IF NOT EXISTS timer_exchanges(
       chat TEXT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE, request TEXT NOT NULL,
       input TEXT NOT NULL, answer TEXT, draft TEXT, receipt TEXT, PRIMARY KEY(chat,request))""",
)
INTENT = re.compile(r"\b(таймер\w*|по расписанию|напоминай|напомни|ежедневно|ежечасно|еженедельно|по будням|кажд(?:ые|ый|ую|ое)\s+(?:\d+\s+)?(?:секунд|минут|час|день|утро|вечер|недел|понедельник|вторник|сред|четверг|пятниц|суббот|воскресень)|раз в\s+(?:\d+\s+)?(?:секунд|минут|час|день|недел)|(?:завтра|сегодня) в \d+[:.]\d{2}|в \d{1,2}[:.]\d{2}\s+(?:пришли|проверь|разбуди|напомни|запусти|отправь|составь|сделай))",re.I)
OBSERVATION_INTENT = re.compile(
    r"\b(?:отслежива(?:й(?:те)?|л[аи]?|ть)|следи(?:те|л[аи]?|ть)?|"
    r"монитор(?:ь(?:те)?|ил[аи]?|ить))\s+(?:за\s+)?"
    r"(?:мо(?:ю|ей|и|ими)\s+)?"
    r"(?:реклам|кампани|ставк|доступност|расход|остатк|склад|продаж|цен|бюджет|баланс|"
    r"заказ|поставк|конкурент|показател|позици|метрик)\w*",
    re.I,
)
COUNTDOWN_INTENT = re.compile(
    r"\bчерез\s+(?:[\w-]+\s+){0,4}(?:секунд\w*|минут\w*|час\w*|день|дня|дней|недел\w*)"
    r"\b[ ,]*\s+(?:пришли|проверь|напомни|запусти|отправь|составь|сделай)\b",
    re.I,
)
TIMER_INFO = re.compile(
    r"\s*(?:что умеет|что такое|зачем нужен|как работает|где найти|как (?:подключить|установить))"
    r"\s+(?:плагин\s+)?[«\"']?таймер[»\"']?[?!. ]*\s*", re.I,
)


def schedule_intent(text):
    if TIMER_INFO.fullmatch(text):
        return False
    if INTENT.search(text) or COUNTDOWN_INTENT.search(text):
        return True
    match = OBSERVATION_INTENT.search(text)
    return bool(match and not re.search(r"\bне\s+$", text[:match.start()], re.I))


YES = re.compile(r"(?:да|да[, ]+устраивает|всё устраивает|все устраивает|устраивает|подтверждаю|сохрани(?: таймер)?|да[, ]+сохрани|да[, ]+так устраивает|да[, ]+вс[её] устраивает)[.! ]*",re.I)


def describe(rule):
    zone = rule["zone"]
    if rule["kind"]=="interval":
        return f"каждые {rule['every_us']/1000000:g} с · {zone}"
    if rule["kind"]=="once":
        return f"{datetime.fromisoformat(rule['at']).astimezone(ZoneInfo(zone)):%d.%m.%Y %H:%M:%S} · {zone}"
    names = ("пн","вт","ср","чт","пт","сб","вс")
    return ", ".join(names[i-1] for i in sorted(set(rule["weekdays"])))+" в "+", ".join(rule["times"])+" · "+zone


def details(plan,rule):
    channels = "чат и ваш Telegram" if plan["telegram"] else "этот чат"
    result = [f"Расписание — {describe(rule)}.",f"Доставка — {channels}.",
              "Уведомления — "+{"all":"каждая проверка","changes":"изменения и ошибки",
                                "errors":"ошибки","goal":"достижение цели и ошибки"}[plan["notify"]]+"."]
    if a := plan.get("action"):
        mode = {"each":"один шаг за проверку","once":"один раз за всё время","edge":"один раз при новом наступлении условия"}[a["mode"]]
        path=a["when"]["path"]
        op={"gt":">","lt":"<","gte":"≥","lte":"≤","eq":"=","ne":"≠","nonempty":"содержит записи"}[a["when"]["op"]]
        label=" → ".join(str(x) for x in path[1:]) or "значение"
        condition=f"Источник {path[0]+1}, {label} {op} "+str(a["when"].get("value",""))
        params=", ".join(f"{k} = {v}" for k,v in a["params"].items())
        result.extend([f"Действие — {a['command']} ({mode}).",
            "Условие — "+condition.strip()+".",
            "Магазин и параметры записи — "+a["connectionId"]+" "+params+"."])
        if step := a.get("adjust"):
            bounds = [f"минимум {step['min']}"] if step.get("min") is not None else []
            if step.get("max") is not None:
                bounds.append(f"максимум {step['max']}")
            result.append(f"Шаг {step['by']}, "+", ".join(bounds)+".")
    return "\n".join(result)


class Dialog:
    def __init__(self,state):
        self.state = state
        self.runtime = Runtime(state)
        self.locks = WeakValueDictionary()
        with state.identity._write() as db:
            for sql in (*SCHEMA,*jobs.SCHEMA):
                db.execute(sql)
        self.scheduler = jobs.Scheduler(state,self.runtime)

    def matches(self, scope, rid, text, hint):
        with self.state.identity._lock:
            db = self.state.identity._db
            active = db.execute("SELECT 1 FROM timer_dialogs WHERE chat=?", (scope.chat_id,)).fetchone()
            replay = db.execute("SELECT 1 FROM timer_exchanges WHERE chat=? AND request=?", (scope.chat_id,rid)).fetchone()
        return bool(hint or replay or active or schedule_intent(text))

    @asynccontextmanager
    async def exclusive_chat(self, chat):
        # Preserve request order across app processes as well as across local coroutines.
        lock = self.locks.setdefault(chat, asyncio.Lock())
        directory = Path(str(self.state.worker.database_path) + ".timer-dialogs")
        directory.mkdir(mode=0o700, exist_ok=True)
        name = hashlib.sha256(chat.encode()).hexdigest()
        async with lock:
            with (directory / name).open("a") as handle:
                while True:
                    try:
                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        await asyncio.sleep(0.05)
                yield

    async def answer(self, scope, token, rid, text, hint=None, zone=None):
        async with self.exclusive_chat(scope.chat_id):
            identity = self.state.identity
            signature = store.encoded([text,hint])
            with identity._write() as db:
                row = db.execute("SELECT input,answer,draft,receipt FROM timer_exchanges WHERE chat=? AND request=?",
                                 (scope.chat_id,rid)).fetchone()
                if row and row[0]!=signature:
                    raise HTTPException(409,"Этот запрос уже использован.")
                if row and row[1] is None:
                    # A prior process stopped mid-test. A write is impossible during preview.
                    answer = "Предыдущий тест прервался. Напишите «Протестировать», чтобы повторить его."
                    db.execute("UPDATE timer_exchanges SET answer=? WHERE chat=? AND request=?",(answer,scope.chat_id,rid))
                    row = (signature,answer,None,None)
                if not row:
                    db.execute("INSERT INTO timer_exchanges(chat,request,input) VALUES(?,?,?)",(scope.chat_id,rid,signature))
            if row:
                _,answer,draft,receipt = row
            else:
                try:
                    answer,draft,receipt = await self.process(scope,token,rid,text,hint,zone)
                except (PlanError,ValueError,HTTPException) as exc:
                    answer = str(exc.detail if isinstance(exc,HTTPException) else exc)
                    draft = receipt = None
                except Exception:
                    import logging
                    logging.getLogger(__name__).exception("Timer setup could not complete")
                    answer,draft,receipt = "Не удалось завершить тест поручения. Напишите «Протестировать» для повтора.",None,None
                with identity._write() as db:
                    db.execute("UPDATE timer_exchanges SET answer=?,draft=?,receipt=? WHERE chat=? AND request=?",
                               (answer,draft,receipt,scope.chat_id,rid))
            result = await self.state.worker.request(scope,"timerExchange",requestId=rid,text=text,answer=answer)
            if receipt:
                with identity._write() as db:
                    db.execute("""UPDATE timer_dialogs SET shown=? WHERE chat=? AND draft=?
                        AND EXISTS(SELECT 1 FROM timer_drafts WHERE id=? AND receipt=?)""",
                        (receipt,scope.chat_id,draft,draft,receipt))
            self.scheduler.wake.set()
            return result

    async def process(self, scope, token, rid, text, hint, zone):
        identity = self.state.identity
        chat = scope.chat_id
        with identity._write() as db:
            ctx = db.execute("SELECT kind,target,zone,instructions,draft,shown FROM timer_dialogs WHERE chat=?",(chat,)).fetchone()
            if hint or not ctx:
                kind,target = (hint.get("kind"),hint.get("eventId")) if hint else (None,None)
                if kind not in ("report","action",None) or (target is not None and not isinstance(target,str)):
                    raise PlanError("Неизвестный тип таймера.")
                if target is not None:
                    kind = store.event(db,scope,target)["kind"]
                zone = zone or "Europe/Moscow"
                try:
                    ZoneInfo(zone)
                except (ValueError,TypeError,ZoneInfoNotFoundError):
                    raise PlanError("Уточните часовой пояс.") from None
                if ctx and ctx[4]:
                    db.execute("DELETE FROM timer_drafts WHERE id=? AND chat=? AND accepted=0",(ctx[4],chat))
                history,draft,shown = [text],None,None
                db.execute("INSERT OR REPLACE INTO timer_dialogs VALUES(?,?,?,?,?,NULL,NULL)",
                           (chat,kind,target,zone,store.encoded(history)))
            else:
                kind,target,zone,history,draft,shown = ctx
                history=json.loads(history)
                if draft and not db.execute("SELECT 1 FROM timer_drafts WHERE id=? AND chat=?",(draft,chat)).fetchone():
                    draft = shown = None
                    db.execute("UPDATE timer_dialogs SET draft=NULL,shown=NULL WHERE chat=?",(chat,))
                if re.fullmatch(r"(?:отмена|отмени настройку|отменить настройку)[.! ]*",text.strip(),re.I):
                    db.execute("DELETE FROM timer_dialogs WHERE chat=?",(chat,))
                    db.execute("DELETE FROM timer_drafts WHERE chat=? AND id=? AND accepted=0",(chat,draft))
                    return "Настройка отменена.",None,None
                if shown and YES.fullmatch(text.strip()):
                    row = store.draft(db,scope,draft)
                    if row["plan"]["telegram"] and not self.state.telegram.status(db,scope.workspace_id)["linked"]:
                        return "Сначала подключите свой Telegram в разделе «Интеграции» или напишите «Только в чат».",None,None
                    event = store.confirm(db,scope,draft,row["revision"],shown)
                    db.execute("DELETE FROM timer_dialogs WHERE chat=?",(chat,))
                    at = recipe.local_time(event["next_us"],event["schedule"]).strftime("%d.%m.%Y %H:%M:%S %Z") if event["next_us"] else "таймер на паузе"
                    answer="Таймер сохранён. Ближайший запуск — "+at+".\n"+details(event["plan"],event["schedule"])
                    db.execute("UPDATE timer_exchanges SET answer=? WHERE chat=? AND request=?",(answer,chat,rid))
                    return answer,None,None
                if draft and shown and re.fullmatch(r"нет[.! ]*",text.strip(),re.I):
                    db.execute("UPDATE timer_drafts SET receipt=NULL WHERE id=? AND accepted=0",(draft,))
                    db.execute("UPDATE timer_dialogs SET shown=NULL WHERE chat=?",(chat,))
                    return "Что изменить в поручении или в ответе?",None,None
                if text.strip().casefold().strip(".! ") not in ("готово","включил","включила","протестировать","повтори тест","подключил","подключила"):
                    history.append(text)
                db.execute("UPDATE timer_dialogs SET shown=NULL,instructions=? WHERE chat=?",(store.encoded(history),chat))
                if draft:
                    row = store.draft(db,scope,draft)
                    store.refine(db,scope,draft,row["revision"],text)
            if not attached(db,scope,"timer"):
                timer = next(plugin for plugin in plugin_statuses(db, scope.workspace_id, chat)
                             if plugin["id"] == "timer")
                step = ("Откройте меню «Таймера» слева и нажмите «Подключить» в этом чате."
                        if timer["installed"] else
                        "Установите «Таймер» в каталоге и нажмите «Подключить» в этом чате.")
                return f"Для фоновой проверки нужен «Таймер». {step} Затем напишите «Готово». Поручение сохранено.", None, None
            available = [dict(id=i,title=json.loads(title)[0],status=status) for i,title,status in db.execute(
                "SELECT id,instructions,status FROM timer_events WHERE chat=? AND workspace=?",(chat,scope.workspace_id))]
            old = store.event(db,scope,target) if target else None
        key = "timer.test."+hashlib.sha256(rid.encode()).hexdigest()[:40]
        async with self.runtime.operation(scope,key,_secret_digest(token)) as grant:
            choice = await self.runtime.prepare(scope,grant,key,history,zone,old,available,kind)
            if choice.get("question"):
                return str(choice["question"]),None,None
            if choice.get("manage"):
                m=choice["manage"]
                with identity._write() as db:
                    if m.get("op")=="list":
                        db.execute("DELETE FROM timer_dialogs WHERE chat=?",(chat,))
                        return "\n".join(f"{r['title']} · {r['status']}" for r in available) or "В этом чате пока нет таймеров.",None,None
                    e = store.event(db,scope,m.get("id",""))
                    if m.get("op")=="edit":
                        db.execute("UPDATE timer_dialogs SET target=?,kind=? WHERE chat=?",(e["id"],e["kind"],chat))
                        return "Редактируем «"+e["instructions"][0]+"». Что изменить?",None,None
                    if m.get("op") not in ("pause","resume","delete"):
                        raise PlanError("Неизвестная операция.")
                    if not re.search({"pause":r"пауз|приостанов|останов","resume":r"возобнов|продолж|сними с пауз",
                                      "delete":r"удал"}[m["op"]],text,re.I):
                        raise PlanError("Уточните, что сделать с выбранным таймером.")
                    store.change_status(db,scope,e["id"],m["op"])
                    db.execute("DELETE FROM timer_dialogs WHERE chat=?",(chat,))
                    return {"pause":"Таймер на паузе.","resume":"Расписание возобновлено.","delete":"Таймер удалён."}[m["op"]],None,None
            rule,plan = choice.get("schedule"),choice.get("plan")
            kind = kind or choice.get("kind")
            recipe.validate(plan,rule,kind)
            if kind == "report":
                plan = {**plan, "notify": "all"}
            with identity._lock:
                db=identity._db
                if plan["telegram"] and not self.state.telegram.status(db,scope.workspace_id)["linked"]:
                    return "Подключите свой Telegram в разделе «Интеграции» и напишите «Готово». Можно также написать «Только в чат».",None,None
            local = recipe.local_time(jobs.now_us(),rule)
            facts = await self.runtime.read(scope,grant,key,"\n".join(history),plan["steps"],local)
            if all(isinstance(f,dict) and f.get("error") for f in facts):
                raise PlanError("Источники не подтвердили данные. "+" ".join(str(f["error"]) for f in facts))
            if kind=="action":
                if any(isinstance(f,dict) and f.get("error") for f in facts):
                    raise PlanError("Обязательный источник не вернул данные для проверки условия.")
                active,args,action_detail = recipe.decision(plan["action"],facts)
                await self.runtime.verify_action(scope,grant,key,"\n".join(history),plan["action"],args)
            report = await self.runtime.render(grant,plan,facts)
            if kind=="action":
                report += "\n\nПредпросмотр действия. "+action_detail
                if args is not None:
                    report += " Параметры при таком результате — "+store.encoded(args)+"."
            reply = report+"\n\n"+details(plan,rule)+"\n\nВас устраивает такой ответ?"
            with identity._write() as db:
                if not draft:
                    row = store.start(db,scope,kind,history[0],target)
                    draft = row["id"]
                    for clarification in history[1:]:
                        row=store.refine(db,scope,draft,row["revision"],clarification)
                else:
                    row=store.draft(db,scope,draft)
                receipt=store.record_preview(db,scope,draft,row["revision"],rule,plan,report)
                db.execute("UPDATE timer_dialogs SET draft=?,kind=? WHERE chat=?",(draft,kind,chat))
            return reply,draft,receipt
