import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from platform_core.chat_connections import attach
from platform_core.guest_registration import RegistrationStore
from platform_core.integrations import IntegrationStore
from platform_core.marketplace_matrix import worker
from platform_core.operation_grants import initialize_grants, issue_grant


class MarketplaceMatrix(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package = tempfile.TemporaryDirectory()
        runtime = Path(cls.package.name) / "runtime"
        worker.unpack(runtime)
        cls.addClassCleanup(cls.package.cleanup)
        cls.addClassCleanup(sys.path.remove, str(runtime))

    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        db = self.root / "account.sqlite"
        key = self.root / "fixture.key"
        key.write_bytes(os.urandom(32))
        self.enterContext(patch.dict(os.environ, {"HARNESS_INTEGRATIONS_KEY_FILE": str(key)}))
        self.identity = self.enterContext(RegistrationStore(db))
        self.identity.create_account("matrix-seller", "fixture-password")
        self.identity.grant_coins("matrix-seller", "50", "seed", "test")
        token = self.identity.login("matrix-seller", "fixture-password")
        self.scope = self.identity.create_user_chat(token)
        integration = IntegrationStore(self.identity)
        self.ids = {}
        for provider, fields in [("wb", {"token": "fixture-wb"}), ("ozon", {"client_id": "fixture-id", "api_key": "fixture-ozon"})]:
            self.ids[provider] = integration.save(token, provider, provider, fields, chatId=self.scope.chat_id)["id"]
        initialize_grants(db)
        grant = issue_grant(db, self.scope, source="chat.turn", run_key="matrix-case")
        self.turn = {"question": "Сколько товаров заказали за 19 ноября?", "requestId": "matrix-case",
                     "databasePath": str(db), "token": grant.token, "deadline": (time.time()+30)*1000}
        self.packet = dict(turn=self.turn, workspace=self.scope.workspace_id, chat=self.scope.chat_id,
                           actor=self.scope.actor_id, connections=list(self.ids.values()))

        self.packet["selections"] = [{"templateId": "B01.ordered_units", "connectionId": cid,
                                     "input": {"period": {"from":"2026-11-19", "to":"2026-11-19"}}}
                                    for cid in self.ids.values()]

    def test_orders_use_catalogue_compiler_http_decoder_and_renderer(self):
        def read(request, **options):
            options["on_dispatch"]()
            data = json.loads(request.data)
            if request.host == "seller-analytics-api.wildberries.ru":
                self.assertEqual(request.get_header("Authorization"), "fixture-wb")
                self.assertEqual(request.full_url.split("/")[-1], "products")
                row = {"product": {"nmId": 101}, "statistic":{"selected":{"period": data["selectedPeriod"], "orderCount": 13}}}
                result = {"data":{"currency":"RUB","products":[row]}}
            else:
                self.assertEqual(request.full_url, "https://api-seller.ozon.ru/v1/analytics/data")
                self.assertEqual(request.get_header("Api-key"), "fixture-ozon")
                self.assertEqual(data["metrics"], ["ordered_units"])
                result = {"result":{"totals":[29],"data":[{"dimensions":[{"id":"2026-11"}],"metrics":[29]}]}}
            return json.dumps(result).encode(), 200
        with patch("http_transport.read_response", side_effect=read):
            result = worker.execute(self.packet, self.root)
        self.assertTrue(result["ok"], result)
        self.assertEqual({x["operation"] for x in result["trace"]["operations"]}, {"ozon_orders","wb_orders"})
        self.assertEqual({x["id"] for x in result["trace"]["templates"]}, {"B01.ordered_units"})
        fields = {r["operation"]: r["metricFields"]["ordered_units"] for r in result["trace"]["operations"]}
        self.assertEqual(fields, {"ozon_orders": "ordered_units", "wb_orders": "orderCount"})
        self.assertIn("13",result["answer"])
        self.assertIn("29",result["answer"])

    def test_revocation_after_selection_prevents_marketplace_read(self):
        from semantics import Rejected
        from platform_core.marketplace_matrix.authority import ChatAuthority
        original = ChatAuthority.credentials
        def revoke(authority, pins, store):
            data = original(authority, pins, store)
            with self.identity._write() as db:
                attach(db, self.scope, self.ids["wb"], False)
            return data
        with patch.object(ChatAuthority, "credentials", revoke), patch("http_transport.read_response") as outbound:
            with self.assertRaises(Rejected):
                worker.execute(self.packet, self.root)
            outbound.assert_not_called()

    def test_provider_cooldown_preserves_retry_time(self):
        import urllib.error
        self.packet["connections"] = [self.ids["ozon"]]
        self.packet["selections"] = [self.packet["selections"][1]]
        with patch("http_transport.read_response", side_effect=urllib.error.HTTPError(
                "https://api-seller.ozon.ru", 429, "rate limited", {"Retry-After":"300"}, None)) as send:
            result = worker.execute(self.packet, self.root)
        self.assertFalse(result["ok"])
        self.assertGreater(result["retryAt"], time.time() + 275)
        self.assertEqual(send.call_count, 1)

    def test_performance_key_does_not_advertise_seller_report(self):
        token = self.identity.login("matrix-seller", "fixture-password")
        cid = IntegrationStore(self.identity).save(token, "ozon", "Реклама",
              {"performance_id": "fixture-id", "performance_secret": "fixture-secret"}, chatId=self.scope.chat_id)["id"]
        self.packet["connections"] = [cid]

        rows = worker.catalogue([(cid, "ozon", ["performance_client_id", "performance_client_secret"])])
        self.assertNotIn("B01.ordered_units", [row["id"] for row in rows])
        from semantics import Rejected
        self.packet["selections"][0]["connectionId"] = cid
        with self.assertRaises(Rejected), patch("http_transport.read_response") as send:
            worker.execute(self.packet, self.root)
        send.assert_not_called()

    def test_agent_can_choose_both_order_metrics_on_short_answer(self):
        from platform_core.marketplace_matrix.plugin import capability
        cid = self.ids["ozon"]
        cap = capability([{"id": cid, "provider":"ozon", "access":["Ozon Seller"]}])
        self.turn["question"] = "все давай"
        self.packet["connections"] = [cid]
        self.packet["selections"] = [{"templateId": tid, "connectionId": cid,
                "input":{"period":{"from":"2026-11-10", "to":"2026-11-15"}}}
                for tid in ("B01.ordered_units","B01.ordered_revenue")]
        cap.validate({"selections": self.packet["selections"]})
        for item in self.packet["selections"]:
            self.assertIn(item["templateId"], cap.description)
        def read(req, **options):
            options["on_dispatch"]()
            data = json.loads(req.data)
            self.assertEqual(req.host, "api-seller.ozon.ru")
            self.assertEqual(data["date_from"], "2026-11-10")
            self.assertEqual(data["date_to"], "2026-11-15")
            values = [{"ordered_units":29, "revenue":7300}[m] for m in data["metrics"]]
            return json.dumps({"result":{"totals":values, "data":[{"dimensions":[{"id":"2026-11"}],
                              "metrics":values}]}}).encode(), 200
        with patch("http_transport.read_response", side_effect=read), patch("template_protocol.payload",
                    side_effect=AssertionError("unexpected selector call")):
            result = worker.execute(self.packet, self.root)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["trace"]["selectionBy"], "chat_agent")
        self.assertEqual({t["id"] for t in result["trace"]["templates"]},
                         {"B01.ordered_units", "B01.ordered_revenue"})
        self.assertIn("29", result["answer"])
        self.assertIn("7300", result["answer"].replace(" ", "").replace("\u00a0", ""))

    def test_another_chat_cannot_reuse_operation(self):
        from semantics import Rejected
        self.packet["chat"] = "another-chat"
        with self.assertRaises(Rejected), patch("http_transport.read_response") as outbound:
            worker.execute(self.packet, self.root)
        outbound.assert_not_called()
