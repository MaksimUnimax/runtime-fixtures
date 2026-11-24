from dataclasses import replace
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

from platform_core import integrations, octopus_knowledge as knowledge
from platform_core.chat_api import create_app
from platform_core.identity import IdentityStore
from platform_core.public_faq import PublicFAQ
from platform_core.user_plugins.registry import CATALOG, Plugin


class PublishedKnowledge(unittest.TestCase):
    def test_publication_update_removal_and_guest(self):
        timer = Plugin("fixture-timer","analytics","Таймер","Ежедневные отчёты", "qa-source",
                       (("Создать расписание","qa-source","fixture"),), "каждый день утром",
                       ("Укажите часовой пояс и нажмите «Сохранить».",))
        with tempfile.TemporaryDirectory() as d:
            faq=PublicFAQ(Path(d)/"faq.db")
            self.addCleanup(faq.close)
            with patch.dict(integrations.PROVIDERS, {"qa-source":{"title":"Тестовые часы","access":["fixture"]}}), \
                    patch.dict(integrations.KEY_GUIDES, {"fixture":["Откройте часы."]}), patch.dict(CATALOG, {timer.id:timer}):
                cards=knowledge.published()
                self.assertEqual(len(cards),10)
                found=next(c for c in cards if c["id"]=="plugin/fixture-timer")
                self.assertEqual(found["operations"][0]["requires"],"integration/qa-source")
                self.assertIn("Таймер",faq.answer("Какие есть плагины?"))
                CATALOG[timer.id]=replace(timer,title="Новый таймер",setup=("Включите расписание.",))
                self.assertIn("Включите расписание.",faq.answer("Как подключить новый таймер?"))
            self.assertNotIn("таймер",faq.answer("Какие есть плагины?").lower())
            self.assertEqual(len(knowledge.published()),8)

    def test_account_preferences_and_cross_chat(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"db"
            with IdentityStore(path) as db:
                for name in ("qa-a","qa-b"):
                    db.create_account(name,"test-password-for-knowledge")
            with TestClient(create_app(path,Path(d)/"chats")) as client:
                def auth(name):
                    token=client.post("/api/login",json={"login":name,"password":"test-password-for-knowledge"}).json()["token"]
                    return {"Authorization":"Bearer "+token}
                a,b=auth("qa-a"),auth("qa-b")
                url="/api/octopus/preferences"
                self.assertEqual(client.get(url).status_code,401)
                settings=client.get(url,headers=a).json()
                change={**settings["current"],"tone":"по-деловому","detail":"кратко"}
                self.assertEqual(client.post(url,headers=a,json=change).status_code,200)
                self.assertEqual(client.post(url,headers=a,json=change).status_code,409)
                self.assertEqual(client.get(url,headers=b).json()["current"],settings["current"])
                reset=client.post(url,headers=a,json={**settings["defaults"],"revision":1})
                self.assertEqual(reset.json()["current"],{**settings["defaults"],"revision":2})
                self.assertEqual(client.post(url,headers=b,json={**change,"tone":"неизвестно"}).status_code,400)

    def test_chat_knowledge_exposes_only_current_delivery_evidence(self):
        import sqlite3
        from types import SimpleNamespace
        with sqlite3.connect(":memory:") as db:
            db.executescript("""
                CREATE TABLE entitlements(workspace_id,plugin_id);
                CREATE TABLE chat_plugins(workspace_id,chat_id,plugin_id);
                CREATE TABLE telegram_subscriptions(workspace,chat,status,last_sent);
                CREATE TABLE octopus_preferences(workspace,address,tone,detail,revision);
                INSERT INTO chat_plugins VALUES('a','one','telegram-reports');
                INSERT INTO telegram_subscriptions VALUES('a','one','ready',12345);
                INSERT INTO telegram_subscriptions VALUES('a','two','ready',67890);
            """)
            scope = SimpleNamespace(workspace_id="a", chat_id="one")
            binding = "plugin/telegram-reports"
            active = knowledge.snapshot(db, scope, [], {"configured":True,"linked":True})
            self.assertEqual(active["states"][binding]["lastSent"], "1970-01-01T03:25:45+00:00")
            self.assertTrue(active["states"][binding]["subscribed"])
            disabled = knowledge.snapshot(db, scope, [], {"configured":False,"linked":False})
            self.assertNotIn("lastSent", disabled["states"][binding])
            self.assertIn("скрыта", disabled["currentSteps"]["integration/telegram"][0])
            self.assertIn("общего бота", disabled["replies"]["integration/telegram"]["text"])
            self.assertIn("Продавец сам", disabled["replies"]["integration/telegram"]["text"])
            ready = knowledge.snapshot(db, scope, [], {"configured": True, "linked": False})
            self.assertNotIn("администратор", ready["replies"]["integration/telegram"]["text"])
            self.assertIn("свой аккаунт", ready["replies"]["integration/telegram"]["text"])
            self.assertIn("уже подключён", active["currentSteps"]["integration/telegram"][0])
            self.assertIn("Последняя отправка", next(c["usage"] for c in active["cards"] if c["id"]==binding))

    def test_compound_request_finds_quantity_and_amount_on_the_real_catalogue(self):
        from platform_core.marketplace_matrix import plugin
        from platform_core.resource_index import select_page
        profiles = (("test","ozon",("seller_api_key","seller_client_id")),)
        records = [*plugin.catalogue(profiles), *plugin.extensions.catalogue(profiles)]
        query = "Продажи за вчера по магазину Учебный Ozon: сумма продаж и количество заказов"
        first, cursor = select_page(records, query, 0, 5)
        ids = {row["id"] for row in first}
        self.assertIn("SUMMARY.58", ids)
        self.assertTrue(ids.intersection({"B05.accrual_seller_amount","B08.finance_sales"}))
        second, _ = select_page(records, query, cursor, 5)
        self.assertTrue(ids.isdisjoint(row["id"] for row in second))
