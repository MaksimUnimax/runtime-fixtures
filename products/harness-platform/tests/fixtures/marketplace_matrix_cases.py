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
        self.assertEqual(result["code"], "HTTP_429")
        self.assertGreater(result["retryAt"], time.time() + 275)
        self.assertEqual(send.call_count, 1)

    def test_429_crosses_original_deadline_and_reuses_grant_and_request(self):
        import sqlite3
        from hashlib import sha256
        from urllib.error import HTTPError

        db = Path(self.turn["databasePath"])
        grant = issue_grant(db, self.scope, source="chat.turn", run_key="matrix-case", ttl_seconds=3)
        original_deadline = int((time.time() + 2.8) * 1000)
        self.turn.update(token=grant.token, deadline=original_deadline, resumeRateLimits=True)
        self.packet["connections"] = [self.ids["ozon"]]
        self.packet["selections"] = [self.packet["selections"][1]]
        requests = []
        def read(req, **options):
            options["on_dispatch"]()
            requests.append((req.full_url, req.data))
            if len(requests) <= 2:
                raise HTTPError(req.full_url, 429, "rate limited", {"Retry-After": "4"}, None)
            return b'{"result":{"totals":[29],"data":[{"dimensions":[{"id":"2026-11"}],"metrics":[29]}]}}', 200

        from dataclasses import replace
        from request_recovery import retry_due
        from repository import Repository
        reserve = Repository.reserve
        def fixture_due(repo, row, request, error, safe):
            return retry_due(repo, row, replace(request, interval=0), error, safe)
        def fixture_reserve(repo, jid, owner, source, interval, limit):
            return reserve(repo, jid, owner, source, 0, limit)
        with patch("http_transport.read_response", side_effect=read), \
             patch("request_recovery.RATE_LIMIT_RETRY_SECONDS", 0), \
             patch("request_recovery.retry_due", fixture_due), patch.object(Repository, "reserve", fixture_reserve):
            result = worker.execute(self.packet, self.root)
        self.assertTrue(result["ok"], result)
        self.assertGreater(int(time.time() * 1000), original_deadline)
        self.assertEqual(requests, requests[:1] * 3)
        with sqlite3.connect(db) as conn:
            row = conn.execute("""SELECT deadline_ms, expires_at FROM marketplace_retry_windows
                                JOIN usage_grants USING(token_hash) WHERE token_hash=?""",
                               (sha256(grant.token.encode()).hexdigest(),)).fetchone()
            self.assertGreater(row[0], original_deadline + 7000)
            self.assertGreater(row[1], time.time())
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM usage_operations").fetchone()[0], 1)

    def test_currency_profile_429_wait_rechecks_access_before_resending(self):
        from urllib.error import HTTPError
        from semantics import Rejected

        self.turn.update(deadline=int((time.time() + 5) * 1000), resumeRateLimits=True)
        cid = self.ids["ozon"]
        self.packet.update(connections=[cid], selections=[{
            "connectionId": cid, "templateId": "B05.accrual_sale_amount",
            "input": {"period": {"from": "2026-11-19", "to": "2026-11-19"}}}])
        def disconnect(_delay):
            with self.identity._write() as db:
                attach(db, self.scope, cid, False)
        with patch("http_transport.read_response", side_effect=HTTPError(
                "https://api-seller.ozon.ru/v1/seller/info", 429, "rate limited", {"Retry-After": "20"}, None)) as send, \
             patch("platform_core.marketplace_matrix.authority.time.sleep", side_effect=disconnect):
            with self.assertRaisesRegex(Rejected, "PERMISSION_DENIED"):
                worker.execute(self.packet, self.root)
        self.assertEqual(send.call_count, 1)

    def test_server_error_preserves_its_cause_after_retry(self):
        from urllib.error import HTTPError
        self.packet["connections"] = [self.ids["ozon"]]
        self.packet["selections"] = [dict(self.packet["selections"][1], templateId="B05.accrual_sale_amount")]
        attempts = []
        def read(req, **options):
            options["on_dispatch"]()
            if req.full_url.endswith("/v1/seller/info"):
                return b'{"company":{"currency":"KZT"}}', 200
            attempts.append(req.full_url)
            delay = "0" if len(attempts) == 1 else "300"
            raise HTTPError(req.full_url, 500, "unavailable", {"Retry-After": delay}, None)
        with patch("http_transport.read_response", side_effect=read):
            result = worker.execute(self.packet, self.root)
        self.assertEqual(len(attempts), 2)
        self.assertEqual(attempts[0], attempts[1])
        self.assertEqual(result["code"], "PROVIDER_SERVER_ERROR")
        self.assertIn("внутреннюю ошибку", worker.seller_result(result)["reason"])
        self.assertGreater(result["retryAt"], time.time() + 275)

    def test_parameter_preview_uses_only_attached_ozon_seller_reads(self):
        from urllib.error import HTTPError
        from semantics import Rejected
        from template_catalog import TEMPLATES
        cid = self.ids["ozon"]
        loss = " ".join(TEMPLATES["parameter.loss_rate.v1"]["notes"])
        delivery = " ".join(TEMPLATES["parameter.delivery_mean.v1"]["notes"])
        projection = " ".join(TEMPLATES["economics.delivery_projection.v1"]["notes"])
        self.assertIn("Один экземпляр учитывается один раз", loss)
        self.assertIn("Доля потерь знаменатель не меняет", delivery)
        self.assertIn("N × d", projection)
        self.assertIn("Расчёт в чате не сохраняет коэффициент", loss)
        self.packet.update(connections=[cid], selections=[{"templateId": "parameter.loss_rate.v1",
                           "connectionId": cid, "input": {"period": {"from": "2026-11-01", "to": "2026-11-07"}}}])
        denied_fields = ["performance_client_id", "performance_client_secret"]
        self.assertNotIn("parameter.loss_rate.v1", {r["id"] for r in worker.catalogue([(cid, "ozon", denied_fields)])})
        visited = []
        def deny(req, **options):
            options["on_dispatch"]()
            self.assertEqual(req.host, "api-seller.ozon.ru")
            self.assertEqual(req.get_header("Api-key"), "fixture-ozon")
            visited.append(req.full_url)
            raise HTTPError(req.full_url, 403, "forbidden", {}, None)
        with patch("http_transport.read_response", side_effect=deny):
            result = worker.execute(self.packet, self.root)
        self.assertFalse(result["ok"])
        self.assertEqual(len(visited), 1, result)
        self.packet["selections"][0]["input"]["parameter_mode"] = "replace_calculated"
        with self.assertRaises(Rejected), patch("http_transport.read_response") as send:
            worker.execute(self.packet, self.root)
        send.assert_not_called()

    def test_drr_returns_exact_denominator_from_source(self):
        cid = self.ids["wb"]
        self.packet.update(connections=[cid], selections=[{
            "templateId": "drr_ordered", "connectionId": cid,
            "input": {"period": {"from": "2026-11-19", "to": "2026-11-19"}}}])
        def read(req, **options):
            options["on_dispatch"]()
            if req.host == "finance-api.wildberries.ru":
                return b'{"currency":"RUB"}', 200
            if req.host == "advert-api.wildberries.ru":
                return b'[{"currency":"RUB","advertId":101,"updSum":1641}]', 200
            self.assertEqual(req.host, "seller-analytics-api.wildberries.ru")
            period = json.loads(req.data)["selectedPeriod"]
            row = {"product": {"nmId": 101}, "statistic": {"selected": {"period": period, "orderSum": 14367}}}
            return json.dumps({"data": {"currency": "RUB", "products": [row]}}).encode(), 200
        with patch("http_transport.read_response", side_effect=read):
            result = worker.seller_result(worker.execute(self.packet, self.root))
        self.assertTrue(result["ok"], result)
        from decimal import Decimal
        values = result["sourceValues"][0]["values"]
        self.assertEqual({(Decimal(v["value"]), v["unit"]) for v in values},
                         {(Decimal(1641), "RUB"), (Decimal(14367), "RUB")})

    def test_currency_is_resolved_once_for_all_selected_monetary_formulas(self):
        from platform_core.marketplace_matrix import store_currency
        from platform_core.marketplace_matrix.authority import ChatAuthority
        authority = ChatAuthority(self.packet)
        cid = self.ids["wb"]
        store = authority.store(next(row for row in authority.frozen if row[0] == cid))
        selections = [{"template_id": tid, "store_id": cid, "input": {}}
                      for tid in ("drr_ordered", "finance_storage_logistics", "finance_storage_logistics_share")]
        with patch.object(store_currency, "profile_currency", return_value="KZT") as fetch:
            store_currency.resolve(authority, selections, {cid: store}, {cid: {"seller_token"}})
        fetch.assert_called_once()
        self.assertEqual(authority.currencies, {cid: "KZT"})

    def test_capability_validates_pairs_of_store_and_template(self):
        from platform_core.marketplace_matrix.plugin import capability
        cap = capability([{"id": self.ids["ozon"], "provider": "ozon", "access": ["Ozon Seller"]},
                          {"id": self.ids["wb"], "provider": "wb", "access": ["Wildberries API"]}])
        selection = {"templateId": "B02.wb_events", "connectionId": self.ids["wb"], "input": {}}
        cap.validate({"selections": [selection]})
        with self.assertRaises(ValueError):
            cap.validate({"selections": [dict(selection, connectionId=self.ids["ozon"])]})

    def test_provider_retry_headers_preserve_the_longer_wb_limit(self):
        from platform_core.marketplace_matrix.store_currency import retry_time
        headers = {"Retry-After": "Thu, 01 Jan 1970 00:02:00 GMT", "X-Ratelimit-Retry": "61"}
        self.assertEqual(retry_time(headers, 100, True), 161)
        self.assertEqual(retry_time(headers, 100, False), 120)
        self.assertIsNone(retry_time({"X-Ratelimit-Retry": "invalid"}, 100, True))

    def test_dataset_catalogue_uses_query_revision_and_attached_credentials(self):
        ozon = self.ids["ozon"]
        wb = self.ids["wb"]
        rows = worker.catalogue([(ozon, "ozon", ["seller_client_id", "seller_api_key"]),
                                 (wb, "wb", ["seller_token"])])
        available = {r["id"]: set(r["available_stores"]) for r in rows}
        self.assertEqual(available["product_registry"], {ozon, wb})
        self.assertEqual(available["accrual_items_days"], {ozon})
        self.assertNotIn("product_registry", {r["id"] for r in worker.catalogue(
            [(ozon, "ozon", ["performance_client_id", "performance_client_secret"])])})

    def test_wb_event_plan_uses_qualified_token_class_and_seller_currency(self):
        import base64
        from datetime import date, timedelta
        token = self.identity.login("matrix-seller", "fixture-password")
        claims = base64.urlsafe_b64encode(b'{"acc":3,"for":"self","t":false}').decode().rstrip("=")
        credential = "fixture." + claims + ".fixture"
        cid = IntegrationStore(self.identity).save(token, "wb", "wb", {"token": credential},
                                                    chatId=self.scope.chat_id)["id"]
        day = (date.today() - timedelta(days=1)).isoformat()
        self.packet.update(connections=[cid], selections=[{"templateId": template, "connectionId": cid,
                           "input": {"period": {"from": day, "to": day}}}
                           for template in ("B02.wb_events", "B03.wb_events")])
        reads = []
        def read(request, **options):
            options["on_dispatch"]()
            self.assertEqual(request.get_header("Authorization"), credential)
            reads.append(request.host)
            if request.host == "finance-api.wildberries.ru":
                return b'{"currency":"KZT"}', 200
            self.assertEqual(request.host, "statistics-api.wildberries.ru")
            return b'[]', 200
        with patch("http_transport.read_response", side_effect=read):
            result = worker.execute(self.packet, self.root)
        self.assertTrue(result["ok"], result)
        self.assertEqual(reads, ["finance-api.wildberries.ru", "statistics-api.wildberries.ru"])

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
            if req.full_url.endswith("/v1/seller/info"):
                return b'{"company":{"currency":"KZT"}}', 200
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
        self.assertIn("KZT", result["answer"])
        self.assertIn("7300", result["answer"].replace(" ", "").replace("\u00a0", ""))

    def test_accrual_uses_scoped_seller_currency_and_retries_original_read(self):
        from urllib.error import HTTPError
        cid = self.ids["ozon"]
        self.packet.update(connections=[cid], selections=[
            {"templateId": tid, "connectionId": cid, "input": {"period": {"from":"2026-11-05", "to":"2026-11-05"}}}
            for tid in ("B05.accrual_sale_units", "B05.accrual_sale_amount")])
        sent = []
        def source(req, **opts):
            opts["on_dispatch"]()
            self.assertEqual(req.get_header("Client-id"), "fixture-id")
            self.assertEqual(req.get_header("Api-key"), "fixture-ozon")
            path = req.full_url.split(".ru")[1]
            sent.append((path, req.data))
            if path == "/v1/seller/info":
                return b'{"company":{"currency":"KZT"}}', 200
            self.assertEqual(path, "/v1/finance/accrual/by-day")
            if len(sent) <= 3:
                raise HTTPError(req.full_url, 429, "rate limited", {"Retry-After": "0"}, None)
            money = lambda amount: {"amount": str(amount), "currency": row_currency}
            commission = {name: money(value) for name, value in {
                "seller_price":100,"sale_amount":200,"sale_price":160,"bonus":40,
                "coinvestment":0,"sale_commission":-10}.items()}
            row = {"accrual_id":123,"date":"2026-11-05","total_amount":money(190),
                   "posting":{"products":[{"quantity":2,"sku":101,"commission":commission,"delivery":None}]}}
            return json.dumps({"accruals":[row],"last_id":""}).encode(), 200
        row_currency = "KZT"
        with patch("http_transport.read_response", side_effect=source), patch("request_recovery.RATE_LIMIT_RETRY_SECONDS", 0):
            result = worker.execute(self.packet, self.root)
        self.assertTrue(result["ok"], result)
        self.assertIn("160", result["answer"])
        self.assertIn("KZT", result["answer"])
        self.assertEqual(result["trace"]["rateLimitResponses"], 2)
        self.assertEqual(sent[1], sent[2])
        self.assertEqual(sent[2], sent[3])
        self.assertEqual(sum(path=="/v1/seller/info" for path, _ in sent), 1)
        row_currency = "RUB"
        with tempfile.TemporaryDirectory() as different, patch("http_transport.read_response", side_effect=source):
            result = worker.execute(self.packet, Path(different))
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "ACCRUAL_PRODUCT_MONEY")

    def test_report_currency_from_source_without_a_store_default(self):
        from finance_stock import decode_wb_finance
        from semantics import Rejected
        task = {"metrics": ["finance_deductions"], "period": {"from": "2026-11-18", "to": "2026-11-19"}}
        accounts = {"id": "a", "platform": "wb", "identity": "b", "currency": None}
        rows = [{"reportId": index, "currency": "KZT", "dateFrom": day, "dateTo": day, "deductionSum": "25.75"}
                for index, day in enumerate(["2026-11-18", "2026-11-19"], 1)]
        result = decode_wb_finance(rows, task, accounts)
        self.assertEqual(result["currency"], "KZT")
        self.assertEqual(result["values"]["finance_deductions"], "51.50")
        self.assertIsNone(accounts["currency"])
        for value, code in (("RUB", "FINANCE_CURRENCY_CHANGED"), (None, "FINANCE_CURRENCY")):
            with self.assertRaises(Rejected) as raised:
                decode_wb_finance([rows[0], {**rows[1], "currency": value}], task, accounts)
            self.assertEqual(raised.exception.code, code)
            public = worker.seller_result({"ok": False, "code": code, "trace": {}, "answer": "INTERNAL"})
            self.assertEqual(set(public), {"ok", "reason"})
            self.assertNotIn(code, public["reason"])

    def test_wb_advertising_keeps_stats_for_returned_campaigns_and_marks_omissions(self):
        import base64

        token = self.identity.login("matrix-seller", "fixture-password")
        claims = base64.urlsafe_b64encode(b'{"acc":3,"for":"self","t":false}').decode().rstrip("=")
        credential = "fixture." + claims + ".signature"
        cid = IntegrationStore(self.identity).save(token, "wb", "Реклама WB", {"token": credential},
                                                     chatId=self.scope.chat_id)["id"]
        self.packet.update(connections=[cid], selections=[{
            "templateId": "wb_active_ads_totals", "connectionId": cid,
            "input": {"period": {"from": "2026-11-19", "to": "2026-11-19"}}}])

        def read(req, **options):
            options["on_dispatch"]()
            self.assertEqual(req.get_header("Authorization"), credential)
            if req.host == "finance-api.wildberries.ru":
                return b'{"currency":"RUB"}', 200
            if "/promotion/count" in req.full_url:
                return b'{"all":2,"adverts":[{"status":9,"count":2,"advert_list":[{"advertId":10},{"advertId":20}]}]}', 200
            self.assertIn("ids=10%2C20", req.full_url)
            return b'[{"advertId":10,"views":100,"clicks":4,"orders":2,"shks":2,"sum_price":500,"sum":80}]', 200

        with patch("http_transport.read_response", side_effect=read):
            result = worker.execute(self.packet, self.root)
        self.assertTrue(result["ok"], result)
        self.assertIn("по 1 из 2", result["answer"])
        self.assertIn("Полная сумма", result["answer"])
        self.assertIn("80", result["answer"])

    def test_forecast_requires_valid_owner_input_and_the_right_shop_credentials(self):
        from platform_core.marketplace_matrix.forecast_preview import normalise_owner_inputs, unit_cost_lines
        from parameter_support.parameter_contract import ParameterError

        cid = self.ids["ozon"]
        names = {"seller_api_key", "seller_client_id"}
        rows = {item["id"] for item in worker.catalogue([(cid, "ozon", names)])}
        self.assertIn("economics.delivery_projection.v1", rows)
        self.assertNotIn("economics.unit_forecast.v1", rows)
        names |= {"performance_client_id", "performance_client_secret"}
        rows = {item["id"] for item in worker.catalogue([(cid, "ozon", names)])}
        self.assertIn("economics.unit_forecast.v1", rows)
        self.assertEqual(normalise_owner_inputs({"unit_cost": 250.50}), {"unit_cost": "250.5"})
        self.assertEqual(normalise_owner_inputs({"unit_cost_by_sku": {"101": 250, "102": "270.10"}}),
                         {"unit_cost_by_sku": {"101": "250", "102": "270.1"}})
        self.assertIn("250 ₽ за единицу для всех товаров",
                      unit_cost_lines([{"value": "250", "origin": "chat_input"}])[0])
        self.assertIn("SKU 102 — 270,1 ₽",
                      unit_cost_lines([{"sku": "102", "value": "270.1", "origin": "chat_input"}])[0])
        for invalid in ({"unit_cost": -1}, {"tax_amount": False}, {"ingredient": 5}):
            with self.assertRaises(ParameterError):
                normalise_owner_inputs(invalid)

    def test_replaying_financial_receipts_reuses_only_the_validated_wire_request(self):
        from read_surface import build, _checked_wire_request
        import read_surface
        from semantics import Rejected

        name = "finance_accrual_by_day"
        _checked_wire_request.cache_clear()
        self.addCleanup(_checked_wire_request.cache_clear)
        with patch("read_surface.subprocess.run", wraps=read_surface.subprocess.run) as bridge:
            first = build("ozon", name, {"date": "2026-11-19", "last_id": ""})
            self.assertTrue(first["url"].startswith("https://api-seller.ozon.ru/"))
            first["url"] = "modified by caller"
            replay = build("ozon", name, {"last_id": "", "date": "2026-11-19"})
            self.assertTrue(replay["url"].startswith("https://api-seller.ozon.ru/"))
            self.assertEqual(bridge.call_count, 1)
            build("ozon", name, {"date": "2026-11-20", "last_id": ""})
            self.assertEqual(bridge.call_count, 2)
            with self.assertRaises(Rejected):
                build("ozon", name, {"date": "wrong", "last_id": ""})

    def test_long_report_extends_only_live_operation_window(self):
        from platform_core.marketplace_matrix.authority import ChatAuthority
        from platform_core.operation_grants import revoke_grant
        from semantics import Rejected

        self.turn.update(deadline=int((time.time() + 30) * 1000), resumeRateLimits=True)
        authority = ChatAuthority(self.packet)
        deadline = authority.deadline
        authority.report_progress()
        self.assertGreater(authority.deadline, deadline + 80)
        self.assertEqual(ChatAuthority(self.packet).deadline, authority.deadline)
        revoke_grant(self.turn["databasePath"], self.turn["token"])
        with self.assertRaises(Rejected):
            authority.check()

    def test_another_chat_cannot_reuse_operation(self):
        from semantics import Rejected
        self.packet["chat"] = "another-chat"
        with self.assertRaises(Rejected), patch("http_transport.read_response") as outbound:
            worker.execute(self.packet, self.root)
        outbound.assert_not_called()
