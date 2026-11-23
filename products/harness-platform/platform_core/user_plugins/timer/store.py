"""Timer drafts and accepted revisions. Call mutations in a single Store._write transaction."""
from datetime import UTC, datetime
import json
from uuid import uuid4

from starlette.exceptions import HTTPException

from ..registry import attached
from . import schedule

PLUGIN = "timer"
SCHEMA = (
    """CREATE TABLE IF NOT EXISTS timer_events(
        id TEXT PRIMARY KEY, workspace TEXT NOT NULL, chat TEXT NOT NULL,
        revision INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('report','action')),
        instructions TEXT NOT NULL, plan TEXT NOT NULL, schedule TEXT NOT NULL,
        anchor_us INTEGER NOT NULL, next_us INTEGER,
        status TEXT NOT NULL CHECK(status IN ('active','paused','completed')),
        FOREIGN KEY(workspace,chat) REFERENCES chats(workspace_id,chat_id) ON DELETE CASCADE)""",
    "CREATE INDEX IF NOT EXISTS timer_events_chat ON timer_events(workspace,chat)",
    "CREATE INDEX IF NOT EXISTS timer_due ON timer_events(next_us) WHERE status='active'",
    """CREATE TABLE IF NOT EXISTS timer_drafts(
        id TEXT PRIMARY KEY, workspace TEXT NOT NULL, chat TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('report','action')),
        target TEXT REFERENCES timer_events(id) ON DELETE CASCADE, base_revision INTEGER,
        revision INTEGER NOT NULL, instructions TEXT NOT NULL, origin TEXT NOT NULL, receipt TEXT,
        plan TEXT, schedule TEXT, preview TEXT, accepted INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(workspace,chat) REFERENCES chats(workspace_id,chat_id) ON DELETE CASCADE)""",
    "CREATE INDEX IF NOT EXISTS timer_drafts_chat ON timer_drafts(workspace,chat)",
    """CREATE TRIGGER IF NOT EXISTS timer_plugin_disabled AFTER DELETE ON chat_plugins
        WHEN OLD.plugin_id='timer' BEGIN
        UPDATE timer_events SET status='paused',next_us=NULL
        WHERE workspace=OLD.workspace_id AND chat=OLD.chat_id AND status='active';
        DELETE FROM timer_drafts WHERE workspace=OLD.workspace_id AND chat=OLD.chat_id AND accepted=0;
        END""",
)


def initialize(db):
    for statement in SCHEMA:
        db.execute(statement)


def require_plugin(db, scope):
    if not attached(db, scope, PLUGIN):
        raise HTTPException(403, "Установите «Таймер» и включите его в этом чате.")


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def instruction(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Опишите поручение Октопусу.")
    return value.strip()


def lookup(db, scope, sql, identifier):
    require_plugin(db, scope)
    cursor = db.execute(sql, (scope.workspace_id, scope.chat_id, identifier))
    row = cursor.fetchone()
    if row is None:
        raise HTTPException(404, "Поручение недоступно в этом чате.")
    return dict(zip((field[0] for field in cursor.description), row))


def event(db, scope, key):
    row = lookup(db, scope, "SELECT * FROM timer_events WHERE workspace=? AND chat=? AND id=?", key)
    for name in ("instructions", "plan", "schedule"):
        row[name] = json.loads(row[name])
    return row


def list_events(db, scope, before=None, page_size=50):
    require_plugin(db, scope)
    cursor = db.execute("""SELECT rowid,id,kind,revision,instructions,schedule,status,next_us
        FROM timer_events WHERE workspace=? AND chat=? AND (? IS NULL OR rowid<?)
        ORDER BY rowid DESC LIMIT ?""", (scope.workspace_id, scope.chat_id, before, before, page_size + 1))
    columns = [field[0] for field in cursor.description]
    rows = [dict(zip(columns, r)) for r in cursor]
    next_cursor = rows[page_size - 1]["rowid"] if len(rows) > page_size else None
    rows = rows[:page_size]
    for row in rows:
        for name in ("instructions", "schedule"):
            row[name] = json.loads(row[name])
    return rows, next_cursor


def draft(db, scope, key):
    row = lookup(db, scope, "SELECT * FROM timer_drafts WHERE workspace=? AND chat=? AND id=?", key)
    for name in ("instructions", "plan", "schedule"):
        if row[name] is not None:
            row[name] = json.loads(row[name])
    return row


def start(db, scope, kind, text, target=None, *, request_id=None):
    require_plugin(db, scope)
    text = instruction(text)
    key = uuid4().hex if request_id is None else request_id
    if not isinstance(key, str) or len(key) != 32 or any(c not in "0123456789abcdef" for c in key):
        raise ValueError("Неверный идентификатор черновика.")
    origin = encoded([kind, target, text])
    exists = db.execute("SELECT 1 FROM timer_drafts WHERE id=?", (key,)).fetchone()
    if exists:
        prior = draft(db, scope, key)
        if prior["origin"] != origin:
            raise HTTPException(409, "Этот запрос уже использован для другого поручения.")
        return prior
    version = None
    instructions = []
    if target is not None:
        if not isinstance(target, str):
            raise ValueError("Выберите существующий таймер.")
        original = event(db, scope, target)
        kind, version, instructions = original["kind"], original["revision"], original["instructions"]
    if kind not in ("report", "action"):
        raise ValueError("Выберите «Отчёт» или «Действие».")
    instructions.append(text)
    db.execute("""INSERT INTO timer_drafts(id,workspace,chat,kind,target,base_revision,revision,instructions,origin)
        VALUES(?,?,?,?,?,?,1,?,?)""", (key, scope.workspace_id, scope.chat_id, kind, target, version, encoded(instructions), origin))
    return draft(db, scope, key)


def editable(row, revision):
    if row["accepted"] or type(revision) is not int or row["revision"] != revision:
        raise HTTPException(409, "Поручение изменилось. Откройте актуальную версию.")


def refine(db, scope, key, revision, text):
    row = draft(db, scope, key)
    editable(row, revision)
    row["instructions"].append(instruction(text))
    db.execute("""UPDATE timer_drafts SET revision=revision+1,instructions=?,receipt=NULL,plan=NULL,
        schedule=NULL,preview=NULL WHERE id=?""", (encoded(row["instructions"]), key))
    return draft(db, scope, key)


def record_preview(db, scope, key, revision, rule, plan, text):
    """Internal hook for a completed read-only test. Never accept a plan from a browser."""
    row = draft(db, scope, key)
    editable(row, revision)
    schedule.validate(rule)
    if not isinstance(plan, dict) or not plan.get("steps"):
        raise ValueError("Для предпросмотра нужен проверенный план выполнения.")
    # Even two tests of one text revision can observe different data.
    receipt = uuid4().hex
    db.execute("UPDATE timer_drafts SET receipt=?,schedule=?,plan=?,preview=? WHERE id=?",
               (receipt, encoded(rule), encoded(plan), instruction(text), key))
    return receipt


def confirm(db, scope, key, revision, receipt, *, now_us=None):
    row = draft(db, scope, key)
    if (not isinstance(receipt, str) or receipt != row["receipt"] or type(revision) is not int
            or revision != row["revision"]):
        raise HTTPException(409, "Сначала подтвердите последний показанный тест.")
    if row["accepted"]:
        return event(db, scope, row["target"])
    now = schedule.instant(datetime.now(UTC)) if now_us is None else now_us
    original = event(db, scope, row["target"]) if row["target"] else None
    if original and original["revision"] != row["base_revision"]:
        raise HTTPException(409, "Таймер уже изменён. Начните уточнение с актуальной версии.")
    rule = row["schedule"]
    if original and original["schedule"] == rule:
        anchor, upcoming = original["anchor_us"], original["next_us"]
        if original["status"] == "paused":
            upcoming = schedule.next_after(rule, now, anchor)
    else:
        anchor, upcoming = now, schedule.next_after(rule, now, now)
    status = original["status"] if original else "active"
    if upcoming is None and status == "active":
        raise HTTPException(409, "Время запуска уже прошло. Уточните расписание и повторите тест.")
    if status != "active":
        upcoming = None
    data = (encoded(row["instructions"]), encoded(row["plan"]), encoded(rule), anchor, upcoming)
    if original:
        target = original["id"]
        db.execute("""UPDATE timer_events SET revision=revision+1,instructions=?,plan=?,schedule=?,
            anchor_us=?,next_us=? WHERE id=?""", (*data, target))
    else:
        target = uuid4().hex
        db.execute("""INSERT INTO timer_events(id,workspace,chat,kind,revision,instructions,plan,schedule,
            anchor_us,next_us,status) VALUES(?,?,?,?,1,?,?,?,?,?,'active')""",
            (target, scope.workspace_id, scope.chat_id, row["kind"], *data))
    db.execute("UPDATE timer_drafts SET accepted=1,target=? WHERE id=?", (target, key))
    return event(db, scope, target)


def cancel(db, scope, key, revision):
    row = draft(db, scope, key)
    editable(row, revision)
    db.execute("DELETE FROM timer_drafts WHERE id=?", (key,))


def change_status(db, scope, key, operation, *, now_us=None):
    row = event(db, scope, key)
    if operation == "delete":
        has_runs = db.execute("SELECT 1 FROM sqlite_schema WHERE name='timer_runs'").fetchone()
        if has_runs and db.execute("SELECT 1 FROM timer_runs WHERE event=? AND state IN ('writing','dispatching')",
                                   (key,)).fetchone():
            raise HTTPException(409,"Дождитесь результата уже начатой операции.")
        db.execute("DELETE FROM timer_events WHERE id=?", (key,))
    elif operation == "pause" and row["status"] == "active":
        db.execute("UPDATE timer_events SET status='paused',next_us=NULL WHERE id=?", (key,))
    elif operation == "resume" and row["status"] == "paused":
        if db.execute("SELECT 1 FROM sqlite_schema WHERE name='timer_runs'").fetchone() and db.execute(
                "SELECT 1 FROM timer_runs WHERE event=? AND outcome='unknown' LIMIT 1",(key,)).fetchone():
            raise HTTPException(409,"Сначала сверьте с площадкой исход незавершённой операции.")
        now = schedule.instant(datetime.now(UTC)) if now_us is None else now_us
        due = schedule.next_after(row["schedule"], now, row["anchor_us"])
        status = "active" if due is not None else "completed"
        db.execute("UPDATE timer_events SET status=?,next_us=? WHERE id=?", (status, due, key))
    elif operation not in ("pause", "resume"):
        raise ValueError("Неизвестная операция с таймером.")
