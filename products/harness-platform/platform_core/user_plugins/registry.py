"""Trusted product catalogue. Conversation attachments use the platform's existing grants."""
from dataclasses import dataclass

from starlette.exceptions import HTTPException


@dataclass(frozen=True)
class Plugin:
    id: str
    category: str
    title: str
    description: str
    provider: str
    # An operation declares the public integration and access it needs.
    operations: tuple = ()
    keywords: str = ""
    setup: tuple = ()


WB = Plugin("wildberries", "analytics", "Вайлдберис",
            "Отчёты WB и сохранённые коэффициенты потерь, доставки и комиссии для магазинов и товаров.", "wb",
            (("Продажи и остатки", "wb", "Wildberries API"), ("Расходы на рекламу (нужна категория «Продвижение» токена WB)", "wb", "Wildberries API")),
            "вб заказы выкупы доход остатки реклама продвижение дрр кампании показы клики траты потратил находили покупатели расход бюджет маркетинг")
OZON = Plugin("ozon", "analytics", "Озон",
              "Отчёты Ozon, доля потерь и стоимость прямой и последней доставки для магазинов и товаров.", "ozon",
              (("Продажи и остатки", "ozon", "Ozon Seller"), ("Расходы на рекламу", "ozon", "Ozon Performance")),
              "озон заказы выкупы доход остатки реклама продвижение дрр кампании показы клики траты потратил находили покупатели расход бюджет маркетинг")
ILLUSTRATIONS = Plugin("illustrations","graphics","Иллюстрации","Создаёт изображения по описанию и прикрепляет их к сообщению.","images", (("Создать изображение", "", ""),), "картинка рисунок нарисуй фото")
TELEGRAM = Plugin("telegram-reports", "documents", "Отчёты в Telegram",
                  "Личная доставка готовых отчётов этого чата в ваш Telegram.", "telegram", (("Доставить отчёт", "telegram", "Telegram"),), "телега телегу тг прислать отправить доставка мессенджер уведомляй",
                  ("Включите плагин в нужном чате, откройте «Отчёты в Telegram» и нажмите «Получать новые отчёты этого чата».",))
CATALOG = {plugin.id: plugin for plugin in (WB, OZON, ILLUSTRATIONS, TELEGRAM)}
CATEGORIES = (
    {"id": "analytics", "title": "Аналитика", "parent": None},
    {"id": "advertising", "title": "Реклама", "parent": None},
    {"id": "graphics", "title": "Графика", "parent": None},
    {"id": "documents", "title": "Документы", "parent": None},
)

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS user_plugin_stores(
       plugin TEXT NOT NULL, cid TEXT NOT NULL REFERENCES account_integrations(id) ON DELETE CASCADE,
       generation TEXT NOT NULL, catalog_at TEXT, PRIMARY KEY(plugin,cid))""",
    """CREATE TABLE IF NOT EXISTS user_plugin_products(
       plugin TEXT NOT NULL, cid TEXT NOT NULL, sku TEXT NOT NULL, offer TEXT NOT NULL, title TEXT NOT NULL,
       PRIMARY KEY(plugin,cid,sku), FOREIGN KEY(plugin,cid) REFERENCES user_plugin_stores ON DELETE CASCADE)""",
    """CREATE TABLE IF NOT EXISTS user_plugin_values(
       plugin TEXT NOT NULL, cid TEXT NOT NULL, sku TEXT NOT NULL, metric TEXT NOT NULL, value TEXT NOT NULL,
       source TEXT NOT NULL, since TEXT, until TEXT, updated TEXT NOT NULL, revision TEXT NOT NULL, basis TEXT,
       PRIMARY KEY(plugin,cid,sku,metric), FOREIGN KEY(plugin,cid) REFERENCES user_plugin_stores ON DELETE CASCADE)""",
    """CREATE TABLE IF NOT EXISTS user_plugin_warehouse_schemes(
       plugin TEXT NOT NULL, cid TEXT NOT NULL, office TEXT NOT NULL, scheme TEXT NOT NULL,
       PRIMARY KEY(plugin,cid,office), FOREIGN KEY(plugin,cid) REFERENCES user_plugin_stores ON DELETE CASCADE)""",
    """CREATE TABLE IF NOT EXISTS user_plugin_models(
       workspace TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
       plugin TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL, PRIMARY KEY(workspace,plugin))""",
)


def attached(db, scope, plugin):
    return db.execute("""SELECT 1 FROM chat_plugins p JOIN workspaces w USING(workspace_id)
        WHERE p.workspace_id=? AND w.owner_id=? AND p.chat_id=? AND p.plugin_id=?""",
        (scope.workspace_id, scope.actor_id, scope.chat_id, plugin)).fetchone()


def store_row(db, scope, plugin, cid):
    if not attached(db, scope, plugin.id):
        raise HTTPException(403, "Плагин отключён в этом чате.")
    row = db.execute("""SELECT c.version,p.generation FROM user_plugin_stores p
        JOIN account_integrations c ON c.id=p.cid JOIN chat_integrations g ON g.connection_id=c.id
        WHERE p.plugin=? AND c.id=? AND c.provider=? AND c.workspace=? AND g.chat_id=?""",
        (plugin.id,cid,plugin.provider,scope.workspace_id,scope.chat_id)).fetchone()
    if not row:
        raise HTTPException(404, "Подключите этот магазин к плагину и разрешите доступ в этом чате.")
    return row

def enable(db, scope, plugin):
    db.execute("INSERT OR IGNORE INTO entitlements VALUES(?,?)",(scope.workspace_id,plugin.id))
    db.execute("INSERT OR IGNORE INTO chat_plugins VALUES(?,?,?)",(scope.workspace_id,scope.chat_id,plugin.id))


def _connect_plugin_store(db, scope, cid, plugin):
    from uuid import uuid4
    enable(db, scope, plugin)
    db.execute("INSERT OR IGNORE INTO user_plugin_stores VALUES(?,?,?,NULL)", (plugin.id, cid, uuid4().hex))


def connect_store(db,scope,cid):
    provider=db.execute("SELECT provider FROM account_integrations WHERE id=? AND workspace=?",(cid,scope.workspace_id)).fetchone()
    for plugin in CATALOG.values():
        if provider==(plugin.provider,):
            _connect_plugin_store(db,scope,cid,plugin)


def install(db):
    from ..storage import Scope
    from .illustrations import SCHEMA as image_schema
    db.execute(image_schema)
    db.execute("""CREATE TABLE IF NOT EXISTS plugin_action_models(workspace TEXT NOT NULL REFERENCES workspaces ON DELETE CASCADE,
        plugin TEXT NOT NULL, action TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL, free INTEGER NOT NULL,
        PRIMARY KEY(workspace,plugin,action))""")
    for statement in SCHEMA:
        db.execute(statement)
    db.execute("CREATE TABLE IF NOT EXISTS user_plugin_migrations(plugin TEXT PRIMARY KEY)")
    for plugin in CATALOG.values():
        if db.execute("SELECT 1 FROM user_plugin_migrations WHERE plugin=?", (plugin.id,)).fetchone():
            continue
        rows=db.execute("""SELECT w.owner_id,w.workspace_id,a.chat_id,a.connection_id FROM chat_integrations a
            JOIN chats c ON c.chat_id=a.chat_id JOIN workspaces w USING(workspace_id)
            JOIN account_integrations i ON i.id=a.connection_id AND i.workspace=w.workspace_id
            WHERE i.provider=? AND NOT EXISTS(SELECT 1 FROM entitlements e
              WHERE e.workspace_id=w.workspace_id AND e.plugin_id=?)""",(plugin.provider,plugin.id)).fetchall()
        for actor,ws,chat,cid in rows:
            _connect_plugin_store(db,Scope(actor,ws,chat),cid,plugin)
        db.execute("INSERT INTO user_plugin_migrations VALUES(?)",(plugin.id,))
