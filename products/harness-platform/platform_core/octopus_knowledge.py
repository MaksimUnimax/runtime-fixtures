"""Published product knowledge and account-level communication preferences."""
from functools import lru_cache
from dataclasses import asdict
from datetime import datetime, timezone
import json

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from .identity import _principal
from .integrations import KEY_GUIDES, published_providers
from .user_plugins.registry import CATALOG

OPTIONS = {"address": ["на вы", "на ты"], "tone": ["дружелюбно", "по-деловому"],
           "detail": ["по существу", "кратко", "подробно"]}
DEFAULTS = {key: values[0] for key, values in OPTIONS.items()}
SCHEMA = """CREATE TABLE IF NOT EXISTS octopus_preferences(
    workspace TEXT PRIMARY KEY REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
    address TEXT NOT NULL, tone TEXT NOT NULL, detail TEXT NOT NULL, revision INTEGER NOT NULL)"""


def preferences(db, workspace):
    row = db.execute("SELECT address,tone,detail,revision FROM octopus_preferences WHERE workspace=?",
                     (workspace,)).fetchone()
    return dict(zip((*OPTIONS, "revision"), row)) if row else {**DEFAULTS, "revision": 0}


def routes(token_for, body):
    async def settings(req):
        token = token_for(req, allow_cookie=True)
        identity = req.app.state.identity
        data = await body(req, *OPTIONS, "revision") if req.method == "POST" else None
        with (identity._write() if data is not None else identity._lock):
            db = identity._db
            _, workspace = _principal(db, token)
            current = preferences(db, workspace)
            if data is not None:
                if type(data["revision"]) is not int or any(data[k] not in v for k, v in OPTIONS.items()):
                    raise HTTPException(400, "Выберите один из предложенных вариантов.")
                if current["revision"] != data["revision"]:
                    raise HTTPException(409, "Настройки уже изменились. Обновите страницу.")
                if any(data[k] != current[k] for k in OPTIONS):
                    db.execute("""INSERT INTO octopus_preferences VALUES(?,?,?,?,?)
                        ON CONFLICT(workspace) DO UPDATE SET address=excluded.address,tone=excluded.tone,
                        detail=excluded.detail,revision=excluded.revision""",
                        (workspace, *(data[k] for k in OPTIONS), current["revision"] + 1))
                    current = preferences(db, workspace)
            return JSONResponse({"current": current, "options": OPTIONS, "defaults": DEFAULTS})
    return [Route("/api/octopus/preferences", settings, methods=["GET", "POST"])]


def published():
    providers = published_providers()
    # Cache only public material. Replacing or removing a registered descriptor
    # changes the key even inside an already running worker.
    key = json.dumps([providers, KEY_GUIDES, [asdict(p) for p in CATALOG.values()]],
                     ensure_ascii=False, sort_keys=True)
    return _cards(key)


@lru_cache(maxsize=4)
def _cards(key):
    providers, guides, plugins = json.loads(key)
    cards = []
    for provider, entry in sorted(providers.items()):
        kinds = entry.get("access", ())
        cards.append(dict(id="integration/" + provider, title=entry["title"], group="Интеграции",
            keywords=entry.get("keywords", ""), **({"aliases": entry["aliases"]} if entry.get("aliases") else {}),
            purpose="Подключение " + entry["title"],
            steps={k: guides[k] for k in kinds if k in guides}, screen="/app/#settings-integrations"))
    published_ids = {c["id"] for c in cards} | {"plugin/" + p["id"] for p in plugins}
    for p in sorted(plugins, key=lambda row: row["id"]):
        ops = [{"task": task, **({"requires": (provider if "/" in provider else "integration/" + provider), "access": access} if provider else {})}
               for task, provider, access in p["operations"]]
        if any(op["requires"] not in published_ids
               for op in ops if "requires" in op):
            raise ValueError("Unpublished dependency in plugin " + p["id"])
        auto = p["provider"] in providers and providers[p["provider"]].get("fields") is not None
        cards.append(dict(id="plugin/" + p["id"], title=p["title"], group="Плагины", purpose=p["description"],
            keywords=p["keywords"], operations=ops, triggers=p["triggers"],
            **({"usage": p["usage"]} if p["usage"] else {}),
            **({"briefSetup": True} if p["setup"] and len(" ".join(p["setup"])) <= 180 and not p["usage"] else {}),
            screen="/app/#settings-plugins",
            steps=list(p["setup"]) or ["Подключите магазин в настройках интеграций из нужного чата. Плагин площадки включится автоматически."
                   if auto else "Откройте «Настройки» → «Плагины», установите плагин и включите его в нужном чате."]))
    return cards


def snapshot(db, scope, rows, telegram):
    states = {}
    for pid, in db.execute("SELECT plugin_id FROM entitlements WHERE workspace_id=?", (scope.workspace_id,)):
        states["plugin/" + pid] = "установлен в аккаунте"
    for pid, in db.execute("SELECT plugin_id FROM chat_plugins WHERE workspace_id=? AND chat_id=?",
                           (scope.workspace_id, scope.chat_id)):
        states["plugin/" + pid] = "включён в этом чате"
    for row in rows:
        keys = ("name", "status", "attached", "access") if row["attached"] else ("attached", "access")
        state = {k: row[k] for k in keys}
        if row["attached"]:
            state["checks"] = row.get("checks", {})
        states.setdefault("integration/" + row["provider"], []).append(state)
    from .user_plugins.telegram_delivery import PLUGIN
    binding = "plugin/" + PLUGIN
    instructions = {}
    replies = {}
    if telegram:
        from .user_plugins.telegram_routes import delivery_state
        delivery = delivery_state(db, scope.workspace_id, scope.chat_id, binding in states and telegram["linked"])
        if delivery["lastSent"] is not None:
            delivery["lastSent"] = datetime.fromtimestamp(delivery["lastSent"], timezone.utc).isoformat()
        states[binding] = {"plugin": states.get(binding, "не установлен"), "subscribed": delivery["subscribed"]}
        if delivery["status"]:
            states[binding]["status"] = delivery["status"]
        if delivery["lastSent"]:
            states[binding]["lastSent"] = delivery["lastSent"]
        if delivery["lastSent"] is None:
            states[binding]["pastDeliveries"] = "Текущий экран не содержит истории. Возможны и ранее отправленные отчёты."
        states["integration/telegram"] = ("подключён" if telegram["linked"] else
            "можно подключить" if telegram["configured"] else "временно недоступен")
        if telegram["linked"]:
            instructions["integration/telegram"] = ["Telegram уже подключён к аккаунту. За доставку отвечают настройки плагина в выбранном чате."]
        elif not telegram["configured"]:
            instructions["integration/telegram"] = ["Кнопка подключения скрыта. Бота настраивает администратор Октопорта вне кабинета продавца."]
            replies["integration/telegram"] = {"topic": "Как сейчас подключить Telegram или начать получать в нём отчёты?",
                "text": "Сейчас подключить Telegram нельзя. Нужно обратиться к администратору Октопорта, чтобы он настроил бота. После этого в настройках интеграций появится кнопка «Подключить Telegram»."}
        last = delivery["lastSent"]
        when = (f"Последняя подтверждённая отправка из этого чата — {last[:10]} в {last[11:16]} UTC."
                if last else "Сейчас в окне плагина нет времени последней отправки. По этому экрану нельзя определить, уходил ли отчёт раньше.")
        last_try = {"unknown":"Результат последней попытки неизвестен. Повтор может прислать дубликат.",
                    "rejected":"Telegram отклонил последнюю попытку.", "limited":"Telegram попросил подождать.",
                    "sending":"Идёт отправка."}.get(delivery["status"], "")
        replies[binding] = {"topic":"Как проверить, ушёл ли отчёт в Telegram, и что известно о прошлых отправках?",
            "text":" ".join(filter(None, (when, last_try,
                "" if delivery["subscribed"] else "Сейчас подписка выключена. Плагин возобновит отправку только после её включения.",
                "В окне плагина «Отчёты в Telegram» есть строка «Последняя отправка», когда время подтверждено. Конкретный отчёт можно проверить в личном чате с ботом.")))}
    return {"cards": published(), "states": states, "currentSteps": instructions, "replies": replies,
            "style": preferences(db, scope.workspace_id)}
