import json
import os
import re
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
        from repository import Repository

        db = Path(self.turn["databasePath"])
        # Test the three-second grant boundary independently of host load.
        now = time.time()
        initialize_repository = Repository.__init__

        def clock():
            return now

        def initialize_with_clock(repository, path):
            initialize_repository(repository, path, clock=clock)

        def advance(seconds):
            nonlocal now
            now += seconds

        self.packet["connections"] = [self.ids["ozon"]]
        self.packet["selections"] = [self.packet["selections"][1]]
        requests = []
        def read(req, **options):
            options["on_dispatch"]()
            requests.append((req.full_url, req.data))
            if len(requests) <= 2:
                raise HTTPError(req.full_url, 429, "rate limited", {"Retry-After": "4"}, None)
            return b'{"result":{"totals":[29],"data":[{"dimensions":[{"id":"2026-11"}],"metrics":[29]}]}}', 200

        with (patch("time.time", clock), patch("time.sleep", advance),
              patch.object(Repository, "__init__", initialize_with_clock),
              patch("http_transport.read_response", side_effect=read)):
            grant = issue_grant(db, self.scope, source="chat.turn", run_key="matrix-case", ttl_seconds=3)
            original_deadline = int((now + 2.8) * 1000)
            self.turn.update(token=grant.token, deadline=original_deadline, resumeRateLimits=True)
            result = worker.execute(self.packet, self.root)
        self.assertTrue(result["ok"], result)
        self.assertGreater(int(now * 1000), original_deadline)
        self.assertEqual(requests, requests[:1] * 3)
        with sqlite3.connect(db) as conn:
            row = conn.execute("""SELECT deadline_ms, expires_at FROM marketplace_retry_windows
                                JOIN usage_grants USING(token_hash) WHERE token_hash=?""",
                               (sha256(grant.token.encode()).hexdigest(),)).fetchone()
            self.assertGreater(row[0], original_deadline + 7000)
            self.assertGreater(row[1], now)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM usage_operations").fetchone()[0], 1)

    def test_ozon_429_wait_and_notice_respect_provider_time(self):
        from platform_core.marketplace_matrix.ozon_retry import plan

        for indicated, seconds in ((None, 7), (100, 0), (99, 0), (102, 2), (160, 60), (409, 309)):
            retry = plan(indicated, 100)
            self.assertEqual((retry.due, retry.seconds, retry.from_header),
                             (100+seconds, seconds, indicated is not None))
        self.assertEqual(plan(None, 100).waiting(), "Озон говорит что занят, пробую еще раз")
        self.assertEqual(plan(160, 100).waiting(),
                         "Ozon просит подождать 1 минуту. Затем я снова запрошу данные.")
        for seconds, duration in ((1, "1 секунду"), (2, "2 секунды"), (11, "11 секунд"),
                                  (21, "21 секунду"), (120, "2 минуты"), (300, "5 минут")):
            self.assertIn(duration, plan(100 + seconds, 100).waiting())
        self.assertIn("сразу", plan(100, 100).waiting())

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

    def test_delivery_projection_accepts_the_chat_preview_and_single_store_total(self):
        from urllib.error import HTTPError

        cid = self.ids["ozon"]
        self.packet.update(connections=[cid], selections=[{
            "templateId": "economics.delivery_projection.v1", "connectionId": cid,
            "input": {"period": {"from": "2026-10-01", "to": "2026-10-01"},
                      "parameter_mode": "preview", "group_by": "total"},
        }])
        def read(req, **options):
            options["on_dispatch"]()
            raise HTTPError(req.full_url, 403, "forbidden", {}, None)

        with patch("http_transport.read_response", side_effect=read) as send:
            worker.execute(self.packet, self.root)
        send.assert_called()
        model_input = self.packet["selections"][0]["input"]
        self.assertEqual(model_input["parameter_mode"], "preview")
        self.assertEqual(model_input["group_by"], "total")

    def test_plugin_coefficients_feed_forecasts_and_fence_changes(self):
        from types import SimpleNamespace
        from platform_core.marketplace_matrix import forecast_preview
        from platform_core.marketplace_matrix.authority import ChatAuthority
        from platform_core.user_plugins.registry import OZON
        from platform_core.user_plugins.store import write_value
        from parameter_support.parameter_contract import CANON
        from semantics import Rejected
        cid=self.ids["ozon"]
        db=self.identity._db
        def put(sku,metric,value,revision=None):
            with self.identity._write() as conn:
                write_value(conn,cid,sku,metric,value,"manual",None,None,None,revision,OZON)
        put("","loss","12.5")
        put("","forward","100.25")
        put("17","loss","0")
        engine=SimpleNamespace()
        forecast_preview.configure(engine,ChatAuthority(self.packet))
        api=engine.parameter_intent_authority
        period={"from":"2026-10-01","to":"2026-10-07"}
        binding=dict(template="economics.unit_forecast.v1",store=cid,tenant=self.scope.workspace_id,
                     job="case",as_of="2026-11-21",input=dict(parameter_periods={},period=period,owner_inputs={"unit_cost":"10"}))
        api.references["ref"]=binding
        readset=dict(scope={"tenant_id":self.scope.workspace_id,"store_id":cid,"provider":"OZON","currency":"RUB"},
                     period=period,rows=[{"sku":sku,"day":period["from"]} for sku in ("17","18")])
        result=api.call(dict(method="report_owner_inputs",reference="ref",job_id="case",readset=readset))
        self.assertTrue(result["ready"])
        for sku,loss in (("17",0),("18",.125)):
            coeff=result["coefficients"][CANON([sku,period["from"]])]
            self.assertEqual(float(coeff["loss_rate"]),loss)
            self.assertEqual(coeff["delivery_mean"],"100.25")
        self.assertTrue(any("вручную" in line for line in forecast_preview.coefficient_lines(result["basis"]["parameters_used"])))
        fence=dict(method="report_owner_fence",reference="ref",checkpoint=result["checkpoint"])
        self.assertTrue(api.call(fence)["current"])
        rev=db.execute("select revision from user_plugin_values where cid=? and sku=? and metric='loss'",(cid,"17")).fetchone()[0]
        put("17","loss","5",rev)
        self.assertFalse(api.call(fence)["current"])
        binding["input"]["parameter_periods"]={"loss_rate":period}
        self.assertEqual([r["key"] for r in api.resolve(binding)["producers"]],["loss_rate"])
        with self.identity._write() as conn:
            conn.execute("delete from chat_plugins where chat_id=? and plugin_id='ozon'",(self.scope.chat_id,))
        with self.assertRaises(Rejected):
            api.resolve(binding)

    def test_local_builder_retry_does_not_repeat_provider_io(self):
        import subprocess
        from types import SimpleNamespace
        from platform_core.marketplace_matrix.read_builder import checked_response
        success=SimpleNamespace(stdout='{"ok":true}',returncode=0)
        with patch("subprocess.run",side_effect=[subprocess.TimeoutExpired("node",5),success]) as build:
            with patch("http_transport.read_response") as provider:
                self.assertTrue(checked_response("contract_bridge.mjs","{}")["ok"])
                provider.assert_not_called()
            self.assertEqual(build.call_count,2)
        deny=SimpleNamespace(stdout='{"ok":false,"error":"READ_REQUEST_INVALID"}',returncode=2)
        with patch("subprocess.run",return_value=deny) as build:
            self.assertFalse(checked_response("contract_bridge.mjs","{}")["ok"])
            self.assertEqual(build.call_count,1)

    def test_sku_delivery_year_window_pagination_and_signed_corrections(self):
        import ozon_sku_delivery as source
        from parameter_support.parameter_contract import ParameterError
        from parameter_support.parameter_producers import expense_components
        period={"from":"2025-11-20","to":"2026-11-19"}
        steps=list(source.steps(period))
        self.assertEqual(len(steps),366)
        self.assertEqual(steps[1]["params"]["date"],period["from"])
        self.assertEqual(steps[-1]["params"]["date"],period["to"])
        types=source.types({"accrual_types":[{"id":n,"name":name} for n,name in
                            enumerate(("Logistic","LastMileCourier","DeliveryToHandoverPlaceByOzon"),10)]})
        state=dict(step=steps[1],rows=[],cursor_seen=[],delivery_types=types)
        def row(identifier,sku,amount):
            money={"amount":amount,"currency":"RUB"}
            return dict(accrual_id=identifier,date=period["from"],total_amount=money,accrued_category="ITEM",
                        posting=None,non_item_fee=None,container_fees=None,item_fees={"fees":[{
                        "sku":sku,"quantity":1,"fees":[{"type_id":10,"accrued":money}]}]})
        # Both historical and current POSTING formats carry the same signed fees.
        from parameter_support import economics_accruals as accruals
        import hashlib
        encode=lambda kind,raw:hashlib.sha256((kind+raw).encode()).hexdigest()
        posting=row("p","10","-12")
        posting.update(accrued_category="POSTING",item_fees=None,unit_number="posting",posting={
            "delivery_schema":"Fbo","products":[{"sku":"10","quantity":1,"commission":None,
            "delivery":{"total_accrued":posting["total_amount"],"services":[{"type_id":10,"accrued":posting["total_amount"]}]}}]})
        modern=accruals.extract(posting,encode)
        posting["posting"]["delivery_speed"]=2
        historical=accruals.extract(posting,encode)
        self.assertEqual(historical["atoms"],modern["atoms"])
        self.assertNotEqual(historical["content_hash"],modern["content_hash"])
        charge=row("a","10","-12")
        self.assertFalse(source.receive(state,{"last_id":"next","accruals":[charge,row("b","20","-300")]}, "10"))
        self.assertTrue(source.receive(state,{"last_id":"","accruals":[charge,row("c","10","2")]}, "10"))
        self.assertEqual(expense_components(state["rows"],{"forward":["logistics"]}),{"forward":"10"})
        state.update(step=steps[2],cursor_seen=[])
        invalid=row("d","10","-1")
        invalid.update(date=state["step"]["params"]["date"],accrued_category="NON_ITEM",
                       non_item_fee={"type_id":10,"accrued":invalid["total_amount"]},item_fees=None)
        with self.assertRaises(ParameterError):
            source.receive(state,{"last_id":"","accruals":[invalid]},"10")

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

    def test_campaign_inventory_requests_and_returns_only_selected_statuses(self):
        from urllib.parse import parse_qs, urlsplit
        from platform_core.marketplace_matrix.plugin import capability

        token = self.identity.login("matrix-seller", "fixture-password")
        ozon = IntegrationStore(self.identity).save(token, "ozon", "Реклама",
              {"performance_id": "fixture-id", "performance_secret": "fixture-secret"}, chatId=self.scope.chat_id)["id"]
        wb = self.ids["wb"]
        tool = capability([{"id": wb, "provider": "wb", "access": ["Wildberries API"]},
                           {"id": ozon, "provider": "ozon", "access": ["Ozon Performance"]}])
        seen = []
        ozon_states = {"RUNNING": "10", "INACTIVE": "20", "STOPPED": "30", "ARCHIVED": "40"}

        def read(request, **options):
            options["on_dispatch"]()
            url = urlsplit(request.full_url)
            query = parse_qs(url.query)
            if url.path == "/api/client/token":
                self.assertEqual(json.loads(request.data)["client_id"], "fixture-id")
                return b'{"access_token":"fixture-access"}', 200
            if url.path == "/api/advert/v3/adverts":
                self.assertEqual(request.get_header("Authorization"), "fixture-wb")
                wb_states = query["statuses"][0]
                seen.append(wb_states)
                if wb_states == "9,11" and "next" not in query:
                    rows = [{"advertId": 10, "status": 9, "settings": {"name": "Активная"}}]
                    payload = {"adverts": rows, "next": "page+2"}
                elif wb_states == "9,11":
                    self.assertEqual(query["next"], ["page+2"])
                    payload = {"adverts": [{"advertId": 20, "status": 11, "settings": {"name": "Пауза"}}]}
                else:
                    payload = {"adverts": [
                        {"advertId": 10, "status": 9, "settings": {"name": "Активная"}},
                        {"advertId": 40, "status": 7, "settings": {"name": "Архив"}}]}
            elif url.path == "/api/client/campaign/search_promo/v2/products":
                self.assertEqual(request.get_header("Authorization"), "Bearer fixture-access")
                self.assertEqual(request.get_method(), "POST")
                page = json.loads(request.data)["page"]
                seen.append(f"cpo:{page}")
                payload = {"total": "3", "products": (
                    [{"sku": "101", "title": "Активный товар", "searchPromoStatus": True},
                     {"sku": "102", "title": "Выключенный товар", "searchPromoStatus": False}]
                    if page == 1 else [{"sku": "103", "title": "Активный товар", "searchPromoStatus": True}])}
            else:
                self.assertEqual(url.path, "/api/client/campaign")
                self.assertEqual(request.get_header("Authorization"), "Bearer fixture-access")
                seen.append(query.get("state", ["all"])[0])
                payload = {"list": [
                    *({"id": cid, "state": "CAMPAIGN_STATE_" + suffix, "title": suffix,
                       "advObjectType": "SKU", "PaymentType": "CPC"}
                      for suffix, cid in ozon_states.items()),
                    {"id": "50", "state": "CAMPAIGN_STATE_RUNNING", "title": "",
                     "advObjectType": "REF_VK", "PaymentType": "CAMPAIGN_TYPE_INVALID"},
                    {"id": "60", "state": "CAMPAIGN_STATE_RUNNING", "title": "Оплата за заказ",
                     "advObjectType": "SEARCH_PROMO", "PaymentType": "CPO"},
                    *({"id": cid, "state": "CAMPAIGN_STATE_RUNNING", "title": kind, "advObjectType": kind}
                      for cid, kind in (("61", "BANNER"), ("62", "VIDEO_BANNER"),
                                        ("63", "REF_BLOGGER"), ("64", "MEDIA_NEW_TYPE")))]}
            return json.dumps(payload).encode(), 200

        for cid, tid, pause_ids in ((wb, "wb_campaign_inventory", ["10", "20"]),
                                    (ozon, "ozon_campaign_inventory", ["10", "20", "30"])):
            for include_pause in (False, True):
                inputs = {"filters": {"campaign_statuses": ["active", "paused"]}} if include_pause else {}
                item = {"templateId": tid, "connectionId": cid, "input": inputs}
                tool.validate({"selections": [item]})
                self.packet.update(connections=[cid], selections=[item])
                with (patch("http_transport.read_response", side_effect=read),
                      patch("platform_core.marketplace_matrix.campaign_inventory.time.sleep")):
                    result = worker.execute(self.packet, self.root)
                campaign_report, = worker.seller_result(result)["campaignReports"]
                self.assertTrue(campaign_report["ok"], campaign_report)
                expected = list(pause_ids if include_pause else ["10"])
                if cid == ozon:
                    expected.extend(("60", "61", "62", "63", "64"))
                    cpo = campaign_report["cpoProducts"]
                    self.assertEqual(cpo["counts"], {"Включён": 2})
                    self.assertEqual([row["sku"] for row in cpo["products"]], ["101", "103"])
                self.assertCountEqual([row["id"] for row in campaign_report["campaigns"]], expected)
        item = {"templateId": "ozon_campaign_inventory", "connectionId": ozon,
                "input": {"filters": {"campaign_statuses": ["all"]}}}
        tool.validate({"selections": [item]})
        self.packet.update(connections=[ozon], selections=[item])
        with (patch("http_transport.read_response", side_effect=read),
              patch("platform_core.marketplace_matrix.campaign_inventory.time.sleep")):
            result = worker.execute(self.packet, self.root)
        report, = worker.seller_result(result)["campaignReports"]
        self.assertCountEqual([row["id"] for row in report["campaigns"]],
                              ["10", "20", "30", "40", "60", "61", "62", "63", "64"])
        self.assertEqual(seen, ["9", "9,11", "9,11", "CAMPAIGN_STATE_RUNNING", "cpo:1", "cpo:2",
                                "CAMPAIGN_STATE_RUNNING", "CAMPAIGN_STATE_INACTIVE", "CAMPAIGN_STATE_STOPPED",
                                "cpo:1", "cpo:2", "all", "cpo:1", "cpo:2"])

    def test_read_templates_are_scoped_to_read_contracts(self):
        from platform_core.marketplace_matrix import ozon_report_file, read_templates, wb_documents
        from platform_core.marketplace_matrix.plugin import read_capability
        from jsonschema import Draft202012Validator
        from read_surface import available, method

        cards = read_templates.cards()
        self.assertEqual(len(cards), 472)
        ready = [card for card in cards.values() if card["state"] == "ready"]
        self.assertTrue(ready)
        for card in ready:
            if card["id"] == ozon_report_file.INFO:
                self.assertEqual((card["profile"], card["http"], card["path"]), ("seller", "POST", "/v1/report/info"))
                continue
            if card["id"] == wb_documents.QR:
                self.assertEqual((card["profile"], card["http"], card["path"]), ("wb", "GET", "/api/v3/supplies/{supplyId}/barcode"))
                continue
            if card["id"] in wb_documents.DOWNLOADS:
                self.assertEqual(card["profile"], "wb")
                self.assertEqual(card["path"], "/api/v1/documents/download" +
                                 ("/all" if card["id"] == wb_documents.BATCH else ""))
                self.assertEqual(card["http"], "POST" if card["id"] == wb_documents.BATCH else "GET")
                continue
            if "contract" in card:
                from urllib.parse import urlsplit
                contract = card["contract"]
                self.assertIsNone(card["operation"])
                self.assertIn(urlsplit(contract["url"]).netloc, read_templates.SUPPLEMENTAL_HOSTS[card["profile"]])
                self.assertEqual(urlsplit(contract["url"]).path, card["path"])
                self.assertEqual(contract["http"], card["http"])
                Draft202012Validator.check_schema(contract["schema"])
                continue
            wb = card["profile"] == "wb"
            meta = method("wb" if wb else "ozon", card["operation"])
            self.assertTrue(available(meta), card)
            self.assertEqual(meta["effect"], "READ")
            self.assertEqual(meta["method"], card["http"])
            self.assertEqual(re.sub(r"\{[^{}]+\}", "{}", meta["wire_path"]).rstrip("/"),
                             re.sub(r"\{[^{}]+\}", "{}", card["path"]).rstrip("/"))
            self.assertFalse(meta.get("completion"), card)
        cid = self.ids["wb"]
        cap = read_capability([{"id": cid, "provider": "wb", "access": ["Wildberries API"]}])
        self.assertNotIn("tariff_commission", cap.description)
        self.assertIsNone(read_capability([{"id": "wordstat", "provider": "wordstat", "access": []}]))
        cap.validate({"action": "find", "connectionId": cid, "query": "api/v1/tariffs/commission"})
        page = read_templates.discover("/api/v1/tariffs/commission", 0, "wb", {"seller_token"})
        self.assertEqual(page["templates"][0]["id"], "read.wb.tariff_commission")
        self.assertLessEqual(len(page["templates"]), read_templates.PAGE_SIZE)
        explicit = read_templates.discover("GET api/v1/tariffs/commission тариф комиссии", 0, "wb", {"seller_token"})
        self.assertEqual([card["id"] for card in explicit["templates"]], ["read.wb.tariff_commission"])
        self.assertFalse(read_templates.discover("/v1/description-category/tree тариф", 0, "wb", {"seller_token"})["templates"])
        self.assertFalse(read_templates.discover("", 0, "ozon", {"seller_token"})["templates"])

    def test_read_templates_dispatch_and_reject_other_store_or_unproven_ids(self):
        from platform_core.marketplace_matrix import read_templates
        from semantics import Rejected

        def execute(profile, cid, alias, params):
            return read_templates.execute({**self.packet, "connections": [cid], "readTemplate": {
                "action": "read", "templateId": f"read.{profile}.{alias}", "params": params,
            }}, self.root)

        def fake_read(request, **options):
            options["on_dispatch"]()
            self.assertEqual(request.full_url, "https://common-api.wildberries.ru/api/v1/tariffs/commission")
            self.assertEqual(request.get_header("Authorization"), "fixture-wb")
            return b'{"report":[{"commission":17,"file_url":"https://example.com/private"}]}', 200

        with patch("http_transport.read_response", side_effect=fake_read) as request:
            result = execute("wb", self.ids["wb"], "tariff_commission", {})
            self.assertEqual(result["data"], {"report": [{"commission": 17}]})
            self.assertEqual(result["operations"], ["read.wb.tariff_commission"])
            with self.assertRaises(Rejected):
                execute("seller", self.ids["wb"], "product_upload_quota", {})
            with self.assertRaises(Rejected):
                execute("wb", self.ids["wb"], "fbs_order_statuses", {"body": {"orders": 987654}})
            request.assert_called_once()

    def test_supplemental_read_templates_validate_and_dispatch(self):
        from platform_core.marketplace_matrix import read_templates
        from semantics import Rejected

        def execute(platform, alias, params):
            cid = self.ids[platform]
            return read_templates.execute({**self.packet, "connections": [cid], "readTemplate": {
                "action": "read", "templateId": alias, "params": params,
            }}, self.root)

        wb = "read.wb.get_api_advert_v0_daily_limits"
        ozon = "read.seller.post_v1_analytics_category_comparison"
        self.turn["question"] = "Проверь лимиты кампаний 12345 и 67890, сравни категории за месяц."
        self.assertEqual(read_templates.supplemental_route(
            read_templates.cards()["read.wb.get_api_supplies_v1_drafts_draftid_items"],
            {"path": {"draftId": "12345"}})[1],
            "https://supplies-api.wildberries.ru/api/supplies/v1/drafts/12345/items")

        def fake_read(request, **options):
            options["on_dispatch"]()
            if request.host == "advert-api.wildberries.ru":
                self.assertEqual(request.full_url, "https://advert-api.wildberries.ru/api/advert/v0/daily-limits?advertIds=12345%2C67890")
                self.assertEqual(request.get_header("Authorization"), "fixture-wb")
            else:
                self.assertEqual(request.full_url, "https://api-seller.ozon.ru/v1/analytics/category/comparison")
                self.assertEqual(request.get_header("Api-key"), "fixture-ozon")
                self.assertEqual(json.loads(request.data), {"period": "MONTH", "sort": "DESC"})
            return b'{"value":17.50,"downloadUrl":"https://example.com/private","email":"owner@example.com"}', 200

        with patch("http_transport.read_response", side_effect=fake_read) as request:
            with self.assertRaises(Rejected):
                execute("wb", wb, {"query": {"advertIds": "12345,00000"}})
            with self.assertRaises(Rejected):
                execute("ozon", ozon, {"period": "MONTH", "sort": "DESC", "extra": True})
            self.assertEqual(execute("wb", wb, {"query": {"advertIds": "12345,67890"}})["data"],
                             {"value": "17.50", "email": "[REDACTED]"})
            self.assertEqual(execute("ozon", ozon, {"period": "MONTH", "sort": "DESC"})["http"], 200)
            self.assertEqual(request.call_count, 2)

    def test_wb_funnel_history_requires_the_history_period_before_dispatch(self):
        from platform_core.marketplace_matrix import read_templates

        self.turn["question"] = "Воронка карточки Wildberries 481155639 с 17 по 21 ноября."
        period = {"start": "2026-11-17", "end": "2026-11-21"}
        request_body = {"nmIds": [481155639], "selectedPeriod": period, "aggregationLevel": "day"}

        def execute(body):
            return read_templates.execute({**self.packet, "connections": [self.ids["wb"]],
                "readTemplate": {"action": "read", "templateId": "read.wb.sales_funnel_history",
                                 "params": {"body": body}}}, self.root)

        def fake_read(request, **options):
            options["on_dispatch"]()
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(request.full_url,
                             "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products/history")
            self.assertEqual(json.loads(request.data), request_body)
            return b'[]', 200

        with patch("http_transport.read_response", side_effect=fake_read) as request:
            failure = execute({"nmIds": [481155639], "currentPeriod": period})
            self.assertFalse(failure["ok"])
            self.assertEqual(failure["reasonSource"], "template")
            request.assert_not_called()
            self.assertEqual(execute(request_body)["data"], [])
            request.assert_called_once()

    def test_read_template_uses_confirmed_subscription_message(self):
        from io import BytesIO
        from urllib.error import HTTPError

        from platform_core.marketplace_matrix import read_templates

        cid = self.ids["ozon"]
        self.turn["question"] = "Покажи пять популярных поисковых запросов Ozon."
        packet = {**self.packet, "connections": [cid], "readTemplate": {
            "action": "read", "templateId": "read.seller.marketplace_search_queries_top",
            "params": {"limit": "5", "offset": "0"},
        }}

        def denial(message):
            return HTTPError("https://api-seller.ozon.ru/v1/search-queries/top", 403, "Forbidden", {},
                             BytesIO(json.dumps({"code": 7, "message": message}).encode()))

        with patch("http_transport.read_response", side_effect=denial("Method available with Premium Pro subscription")):
            result = read_templates.execute(packet, self.root)
        self.assertEqual(result["reasonSource"], "template")
        self.assertEqual(result["reason"], "Для отчёта о популярных поисковых запросах на Ozon нужен Premium Pro.")
        with patch("http_transport.read_response", side_effect=denial("no access to this method")):
            result = read_templates.execute(packet, self.root)
        self.assertTrue(result["requiresTestReview"])
        self.assertNotIn("reason", result)

    def test_read_template_reports_actual_sample_size_and_tariff_scheme(self):
        from platform_core.marketplace_matrix import read_templates

        cid = self.ids["wb"]
        packet = {**self.packet, "connections": [cid], "readTemplate": {
            "action": "read", "templateId": "read.wb.tariff_commission", "params": {},
        }}
        rows = [{"subjectName": "Предмет", "kgvpMarketplace": 38, "paidStorageKgvp": 33.5,
                 "kgvpSupplier": 35, "parentName": "Категория"} for _ in range(500)]
        raw = json.dumps({"report": rows}, ensure_ascii=False).encode()
        with patch("http_transport.read_response", return_value=(raw, 200)):
            result = read_templates.execute(packet, self.root)
        report = result["data"]["report"]
        self.assertFalse(any(item is None for item in report))
        self.assertLess(len(report), len(rows))
        self.assertEqual(result["coverage"],
                         [{"path": "$.report", "availableRows": 500, "returnedRows": len(report)}])
        self.assertEqual(result["fieldLabels"]["paidStorageKgvp"], "Со склада Wildberries (FBW), %")
        self.assertIn("DBS", result["fieldLabels"]["kgvpSupplier"])

    def test_read_template_keeps_all_bid_groups_before_sampling_categories(self):
        from platform_core.marketplace_matrix import read_templates

        card = read_templates.cards()["read.performance.performance_bid_limits"]
        rows = [{"minBid": 7, "maxBid": 200, "categories": [{"category": "Игрушки", "bid": 8}] * 281}
                for _ in range(7)]
        sample, _, coverage = read_templates._result_sample({"limits": rows}, card["sampleRows"])
        self.assertEqual(len(sample["limits"]), 7)
        self.assertTrue(all(len(row["categories"]) == 3 for row in sample["limits"]))
        self.assertEqual([entry["availableRows"] for entry in coverage], [281] * 7)

    def test_read_template_explains_unproven_subject_without_calling_wb(self):
        from platform_core.marketplace_matrix import read_templates

        packet = {**self.packet, "connections": [self.ids["wb"]], "readTemplate": {
            "action": "read", "templateId": "read.wb.content_brands", "params": {"query": {"subjectId": 12345}},
        }}
        with patch("http_transport.read_response") as outbound:
            result = read_templates.execute(packet, self.root)
        outbound.assert_not_called()
        self.assertEqual(result["reasonSource"], "template")
        self.assertEqual(result["reason"], "Чтобы показать бренды Wildberries, укажите точный ID предмета.")
        self.assertIsNone(result["http"])

    def test_read_template_explains_documented_wb_outage_only_on_not_found(self):
        from io import BytesIO
        from urllib.error import HTTPError

        from platform_core.marketplace_matrix import read_templates

        url = "https://supplies-api.wildberries.ru/api/v1/warehouses"
        packet = {**self.packet, "connections": [self.ids["wb"]], "readTemplate": {
            "action": "read", "templateId": "read.wb.fbw_warehouses", "params": {},
        }}
        with patch("http_transport.read_response", side_effect=HTTPError(url, 404, "", {}, BytesIO())):
            result = read_templates.execute(packet, self.root)
        self.assertEqual(result["reasonSource"], "template")
        self.assertEqual(result["reason"], "Wildberries временно отключил выдачу списка складов для поставок на склад Wildberries.")
        with patch("http_transport.read_response", return_value=(b'[{"ID":1,"name":"Test"}]', 200)):
            result = read_templates.execute(packet, self.root)
        self.assertTrue(result["ok"])
        self.assertNotIn("reason", result)

    def test_read_template_treats_documented_wb_no_content_as_empty_report(self):
        from platform_core.marketplace_matrix import read_templates

        packet = {**self.packet, "connections": [self.ids["wb"]], "readTemplate": {
            "action": "read", "templateId": "read.wb.analytics_item_returns",
            "params": {"query": {"dateFrom": "2026-11-20", "dateTo": "2026-11-21", "status": "archive",
                                 "limit": 100, "offset": 0}},
        }}
        with patch("http_transport.read_response", return_value=(b"", 204)):
            result = read_templates.execute(packet, self.root)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["http"], 204)
        self.assertEqual(result["data"], {"count": 0, "report": []})

    def test_read_template_keeps_wb_document_dates_in_moscow(self):
        from platform_core.marketplace_matrix import read_templates

        card = read_templates.cards()["read.wb.documents_list"]
        data = {"data": {"documents": [{"creationTime": "2026-11-08T22:15:00.123Z",
                                       "name": "Документ от 8 ноября"}]}}
        sample, _, coverage = read_templates._result_sample(
            data, card["sampleRows"], card["responseTimeZones"],
        )
        self.assertEqual(sample["data"]["documents"], [{"creationTime": "2026-11-09T01:15:00.123000+03:00",
                                                       "name": "Документ от 8 ноября"}])
        self.assertEqual(coverage, [])

    def test_wb_questions_and_feedbacks_use_exact_calendar_boundaries(self):
        from urllib.parse import parse_qs, urlsplit
        from platform_core.marketplace_matrix import read_templates
        from semantics import Rejected

        def execute(name, params):
            return read_templates.execute({**self.packet, "connections": [self.ids["wb"]],
                                           "readTemplate": {"action": "read", "templateId": f"read.wb.{name}",
                                                            "params": {"query": params}}}, self.root)

        params = {"isAnswered": False, "take": 5, "skip": 0,
                  "dateFrom": "2026-11-20", "dateTo": "2026-11-21"}
        for name in ("questions_list", "feedbacks_list"):
            with self.subTest(name=name), patch("http_transport.read_response", return_value=(b'{"data": {}}', 200)) as outbound:
                self.assertTrue(execute(name, params)["ok"])
                self.assertTrue(execute(name, {**params, "dateFrom": 1795122000, "dateTo": 1795294799})["ok"])
                for call in outbound.call_args_list:
                    query = parse_qs(urlsplit(call.args[0].full_url).query)
                    self.assertEqual(query["dateFrom"], ["1795122000"])
                    self.assertEqual(query["dateTo"], ["1795294799"])
                with self.assertRaises(Rejected):
                    execute(name, {**params, "dateFrom": "2026-02-30"})
                self.assertEqual(outbound.call_count, 2)

        with patch("http_transport.read_response", return_value=(b'{"data": {}}', 200)) as outbound:
            self.assertTrue(execute("warehouse_measurements", {
                "limit": 5, "offset": 0, "dateFrom": "2026-11-20", "dateTo": "2026-11-21",
            })["ok"])
            query = parse_qs(urlsplit(outbound.call_args.args[0].full_url).query)
            self.assertEqual(query["dateFrom"], ["2026-11-20T00:00:00+03:00"])
            self.assertEqual(query["dateTo"], ["2026-11-21T23:59:59+03:00"])

    def test_fbo_cluster_summary_keeps_fulfillment_after_a_large_mixed_warehouse_list(self):
        from platform_core.marketplace_matrix import read_templates

        sorting = [{"type": "SORTING_CENTER", "name": f"Sorting {i}"} for i in range(100)]
        one, two, three = [{"type": "FULL_FILLMENT", "name": f"Warehouse {i}"} for i in range(1, 4)]
        clusters = [
            {"id": 10, "name": "First", "logistic_clusters": [{"warehouses": sorting + [one]},
                                                             {"warehouses": [two, three]}]},
            {"id": 11, "name": "Second", "logistic_clusters": [{"warehouses": sorting}]},
            {"id": 12, "name": "Third"},
        ]
        result = read_templates.fulfillment_clusters({"clusters": clusters})
        self.assertEqual(result, {"totalClusters": 3, "clusters": [
            {"id": 10, "name": "First", "firstFulfillmentWarehouses": ["Warehouse 1", "Warehouse 2"],
             "fulfillmentWarehouseCount": 3},
            {"id": 11, "name": "Second", "firstFulfillmentWarehouses": [], "fulfillmentWarehouseCount": 0},
            {"id": 12, "name": "Third"},
        ]})

    def test_posting_cancellation_details_only_disclose_the_requested_posting(self):
        from platform_core.marketplace_matrix import read_templates

        target = "12345678-0001-1"
        params = {"posting_number": target}
        read = {"action": "read", "templateId": read_templates.POSTING_CANCELLATION_DETAILS, "params": params}
        packet = {**self.packet, "connections": [self.ids["ozon"]],
                  "turn": {**self.turn, "question": f"Причина отмены {target}?"},
                  "readTemplate": read}
        unrelated = "87654321-0002-1"
        cancellation = {"cancel_reason": "Ограничение на продажу", "cancellation_initiator": "Ozon"}
        def returned(number, status):
            payload = {"result": {"posting_number": number, "status": status, "cancellation": cancellation,
                                  "customer": {"name": "Private contact"}, "tracking_number": "Private tracking"}}
            return json.dumps(payload, ensure_ascii=False).encode(), 200
        with patch("http_transport.read_response", return_value=returned(target, "cancelled")) as outbound:
            result = read_templates.execute(packet, self.root)
            self.assertEqual(outbound.call_args.args[0].full_url, "https://api-seller.ozon.ru/v3/posting/fbs/get")
            self.assertEqual(json.loads(outbound.call_args.args[0].data), params)
        self.assertEqual(result["data"], {"posting_number": target, "status": "cancelled",
                                        "reason":"Ограничение на продажу","initiator":"Ozon"})
        with patch("http_transport.read_response", return_value=returned(target, "delivering")):
            self.assertEqual(read_templates.execute(packet, self.root)["data"],
                             {"posting_number": target, "status": "delivering"})
        with patch("http_transport.read_response", return_value=returned(unrelated, "cancelled")):
            denied = read_templates.execute(packet, self.root)
            self.assertNotIn("data", denied)
            self.assertEqual(denied["reasonSource"], "template")

    def test_digital_posting_filter_and_confirmed_service_seller_denial(self):
        from io import BytesIO
        from urllib.error import HTTPError
        from platform_core.marketplace_matrix import read_templates

        url = "https://api-seller.ozon.ru/v2/posting/digital/list"
        params = {"limit": 5, "filter": {"since": "2026-11-16T00:00:00Z", "to": "2026-11-22T23:59:59Z"},
                  "sort_dir": "ASC"}
        read = {"action": "read", "templateId": "read.seller.posting_digital_list_v2", "params": params}
        packet = {**self.packet, "connections": [self.ids["ozon"]],
                  "turn": {**self.turn, "question":"Первая страница цифровых отправлений"},
                  "readTemplate": read}
        with patch("http_transport.read_response") as outbound:
            missing = {**packet, "readTemplate": {**read, "params": {"limit":5}}}
            self.assertEqual(read_templates.execute(missing,self.root)["reasonSource"],"template")
            outbound.assert_not_called()
        rule = "commonService.PostingDigitalList: rpc error: code = PermissionDenied desc = Method can only be used by a service seller"
        for message, known in ((rule, True), ("Permission denied", False)):
            body = json.dumps({"code": 7, "message": message}).encode()
            with self.subTest(known=known), patch("http_transport.read_response", side_effect=HTTPError(
                    url, 403, "Denied", {}, BytesIO(body))) as outbound:
                output = read_templates.execute(packet, self.root)
            request = outbound.call_args.args[0]
            self.assertEqual(request.full_url,url)
            self.assertEqual(json.loads(request.data),params)
            self.assertEqual(output.get("reasonSource") == "template", known)
            if known:
                self.assertIn("только продавцам услуг",output["reason"])
            else:
                self.assertTrue(output["requiresTestReview"])

    def test_rfbs_return_points_explain_only_confirmed_missing_key_role(self):
        from io import BytesIO
        from urllib.error import HTTPError
        from platform_core.marketplace_matrix import read_templates

        path = "https://api-seller.ozon.ru/v1/warehouse/rfbs/return-point/list"
        packet = {**self.packet, "connections": [self.ids["ozon"]],
                  "readTemplate": {"action": "read",
                                   "templateId": "read.seller.post_v1_warehouse_rfbs_return_point_list",
                                   "params": {"filters": {"country_code": "RU", "coordinates": {
                                       "latitude": 55.7558, "longitude": 37.6173}}, "limit": 5}}}
        for message, known in (("Api-Key is missing a required role for a method", True), ("Permission denied", False)):
            body = json.dumps({"code": 7, "message": message}).encode()
            with self.subTest(known=known), patch("http_transport.read_response", side_effect=HTTPError(
                    path, 403, "Denied", {}, BytesIO(body))) as outbound:
                result = read_templates.execute(packet, self.root)
            self.assertEqual(outbound.call_args.args[0].full_url, path)
            self.assertFalse(result["ok"])
            self.assertEqual(result.get("reasonSource") == "template", known)
            if known:
                self.assertIn("API-ключу Ozon не хватает прав", result["reason"])
            else:
                self.assertTrue(result["requiresTestReview"])

    def test_wb_shipping_points_explains_only_confirmed_date_error(self):
        from io import BytesIO
        from urllib.error import HTTPError
        from platform_core.marketplace_matrix import read_templates

        supply = "WB-GI-1234567"
        packet = {**self.packet, "connections": [self.ids["wb"]],
                  "turn": {**self.packet["turn"], "question": f"Куда отгрузить поставку {supply}?"},
                  "readTemplate": {"action": "read",
                                   "templateId": "read.wb.get_api_marketplace_v3_fbs_supplies_supplyid_shipping_points",
                                   "params": {"path": {"supplyId": supply},
                                              "query": {"city": "Москва", "officeType": "sc"}}}}
        for payload, known in ((b'{"code":"ShippingDtRequired"}', True), (b'{"code":"Other"}', False)):
            with self.subTest(known=known), patch("http_transport.read_response", side_effect=HTTPError(
                    "https://marketplace-api.wildberries.ru/", 400, "Invalid request", {}, BytesIO(payload))):
                result = read_templates.execute(packet, self.root)
            self.assertEqual(result.get("reasonSource") == "template", known)
            if known:
                self.assertIn("плановую дату отгрузки", result["reason"])

    def test_wb_search_report_sends_required_order_without_overriding_explicit_order(self):
        from platform_core.marketplace_matrix import read_templates

        body = {"currentPeriod": {"start": "2026-11-17", "end": "2026-11-21"}, "positionCluster": "all",
                "includeSearchTexts": True, "includeSubstitutedSKUs": False, "limit": 5, "offset": 0}
        default = {"field": "openCard", "mode": "desc"}
        explicit = {"field": "openCard", "mode": "asc"}
        for request_body, expected in ((body, default), ({**body, "orderBy": explicit}, explicit)):
            with self.subTest(order=request_body.get("orderBy")), patch(
                    "http_transport.read_response", return_value=(b'{"data":{"visibilityInfo":{"openCard":{"current":42}}}}', 200)
            ) as outbound:
                reply = read_templates.execute({**self.packet, "connections": [self.ids["wb"]], "readTemplate": {
                    "action": "read", "templateId": "read.wb.search_report_main", "params": {"body": request_body},
                }}, self.root)
            self.assertTrue(reply["ok"])
            self.assertEqual(json.loads(outbound.call_args.args[0].data), {**body, "orderBy": expected})
        self.assertNotIn("orderBy", body)

    def test_wb_media_list_defaults_to_active_and_preserves_explicit_status(self):
        from urllib.parse import parse_qs, urlsplit
        from platform_core.marketplace_matrix import read_templates

        for query, expected in (({}, ["6"]), ({"status": "all"}, None), ({"status": 8}, ["8"])):
            with self.subTest(query=query), patch("http_transport.read_response", return_value=(b"", 204)) as outbound:
                result = read_templates.execute({**self.packet, "connections": [self.ids["wb"]],
                                                 "readTemplate": {"action": "read", "templateId": "read.wb.media_campaigns",
                                                                  "params": {"query": query}}}, self.root)
                self.assertEqual(result["data"], [])
                url = outbound.call_args.args[0].full_url
                self.assertEqual(parse_qs(urlsplit(url).query).get("status"), expected)

    def test_wb_acquiring_details_require_report_from_that_stores_list(self):
        from platform_core.marketplace_matrix import read_templates
        from platform_core.marketplace_matrix.authority import ChatAuthority

        packet = {**self.packet, "connections": [self.ids["wb"]], "readTemplate": {
            "action": "read", "templateId": read_templates.WB_ACQUIRING_DETAIL,
            "params": {"path": {"reportId": "858626798"}, "body": {"limit": 5, "rrdId": 0}},
        }}
        revision = ChatAuthority(packet).revision
        ids = list(read_templates.observed_acquiring_reports([{"reportId": 858626798}]))
        self.assertEqual(len(ids), 1)
        with patch("http_transport.read_response", return_value=(b'[]', 200)) as outbound:
            result = read_templates.execute(packet | {"readEvidence": {"revision": "stale", "ids": ids}}, self.root)
            self.assertEqual(result["reasonSource"], "template")
            result = read_templates.execute(packet | {"readEvidence": {"revision": revision, "ids": ["858626798"]}}, self.root)
            self.assertEqual(result["reasonSource"], "template")
            sales_packet = {**packet, "readTemplate": {**packet["readTemplate"],
                                                        "templateId": read_templates.WB_SALES_DETAIL}}
            result = read_templates.execute(sales_packet | {"readEvidence": {"revision": revision, "ids": ids}}, self.root)
            self.assertFalse(result["ok"])
            self.assertEqual(result["reasonSource"], "template")
            sales_ids = list(read_templates.observed_sales_reports([{"reportId": 858626798}]))
            self.assertEqual(len(sales_ids), 1)
            result = read_templates.execute(sales_packet | {"readEvidence": {"revision": "stale", "ids": sales_ids}}, self.root)
            self.assertFalse(result["ok"])
            outbound.assert_not_called()
            result = read_templates.execute(packet | {"readEvidence": {"revision": revision, "ids": ids}}, self.root)
            self.assertTrue(result["ok"], result)
            self.assertTrue(outbound.call_args.args[0].full_url.endswith("/acquiring/detailed/858626798"))
            result = read_templates.execute(sales_packet | {"readEvidence": {"revision": revision, "ids": sales_ids}}, self.root)
            self.assertTrue(result["ok"])
            self.assertTrue(outbound.call_args.args[0].full_url.endswith("/sales-reports/detailed/858626798"))
            self.assertEqual(result["salesDetailPreview"], [])

    def test_wb_files_require_list_proof_and_are_stored_only_in_requesting_chat(self):
        from base64 import b64encode
        from io import BytesIO
        from zipfile import ZipFile

        from platform_core.chat_attachments import _read
        from platform_core.identity import ChatUnavailable
        from platform_core.marketplace_matrix import read_templates, wb_documents
        from platform_core.marketplace_matrix.authority import ChatAuthority
        from platform_core.storage import Scope

        journal = self.root / "native-chats.sqlite3"
        archive = BytesIO()
        with ZipFile(archive, "w") as zip_file:
            zip_file.writestr("fixture.xlsx", b"fixture")
        file_content = archive.getvalue()
        doc = {"serviceName": "act-fixture-123", "extension": "xlsx"}
        proof = list(wb_documents.observed_documents({"data":{"documents":[{
            "serviceName":"act-fixture-123", "extensions":["xlsx"],
        }]}}))
        body = {"data":{"extension":"zip", "fileName":"fixture.zip", "document":b64encode(file_content).decode()}}
        packet = {**self.packet, "connections": [self.ids["wb"]],
                  "turn": {**self.turn, "attachmentsJournal": str(journal)}}
        revision = ChatAuthority(packet).revision
        for template, params, method in ((wb_documents.SINGLE, {"query": doc}, "GET"),
                                         (wb_documents.BATCH, {"body": {"params": [doc]}}, "POST")):
            with self.subTest(template=template), patch("http_transport.read_response", return_value=(json.dumps(body).encode(), 200)) as outbound:
                task = {**packet, "readTemplate": {"action": "read", "templateId": template, "params": params}}
                for evidence in ({}, {"revision": "stale", "ids": proof},
                                 {"revision": revision, "ids": [wb_documents.proof(doc["serviceName"], "pdf")]}):
                    rejected = read_templates.execute(task | {"readEvidence": evidence}, self.root)
                    self.assertEqual(rejected["reasonSource"], "template")
                outbound.assert_not_called()
                result = read_templates.execute(task | {"readEvidence": {"revision": revision, "ids": proof}}, self.root)
                self.assertTrue(result["ok"], result)
                self.assertEqual(outbound.call_args.args[0].get_method(), method)
                file = result["data"]["file"]
                self.assertEqual(file["name"], "fixture.zip")
                self.assertEqual(file["bytes"], len(file_content))
                self.assertEqual(file["archiveEntriesByFormat"], {"xlsx": 1})
                self.assertEqual(_read(journal, self.scope, file["attachmentId"]), ("fixture.zip", file_content))
                self.assertNotIn(body["data"]["document"], json.dumps(result))
                with self.assertRaises(ChatUnavailable):
                    _read(journal, Scope(self.scope.actor_id, self.scope.workspace_id, "another-chat"), file["attachmentId"])

    def test_ozon_report_file_requires_its_stores_list_and_never_sends_credentials_to_file_host(self):
        from platform_core.chat_attachments import _read
        from platform_core.marketplace_matrix import ozon_report_file, read_templates
        from platform_core.marketplace_matrix.authority import ChatAuthority

        journal = self.root / "native-chats.sqlite3"
        code = "REPORT_fixture_001"
        packet = {**self.packet, "connections": [self.ids["ozon"]],
                  "turn": {**self.turn, "attachmentsJournal": str(journal)},
                  "readTemplate": {"action": "read", "templateId": ozon_report_file.INFO,
                                   "params": {"code": code, "download": True}}}
        revision = ChatAuthority(packet).revision
        proof = list(ozon_report_file.observed_reports({"result": {"reports": [{"code": code}]}}))
        report = {"code": code, "status": "success", "expires_at": "2100-01-01T00:00:00Z", "report_type": "fixture",
                  "file": "https://ir.ozone.ru/reports/report.pdf?private=fixture"}
        pdf = b"%PDF-1.4\nfixture"
        metadata = lambda: (json.dumps({"result": report}).encode(), 200)
        with patch("http_transport.read_response", side_effect=[metadata(), (pdf, 200)]) as outbound:
            for evidence in ({}, {"revision": "stale", "ids": proof}):
                rejected = read_templates.execute(packet | {"readEvidence": evidence}, self.root)
                self.assertEqual(rejected["reasonSource"], "template")
            outbound.assert_not_called()
            result = read_templates.execute(packet | {"readEvidence": {"revision": revision, "ids": proof}}, self.root)
            self.assertTrue(result["ok"], result)
            source, file = [call.args[0] for call in outbound.call_args_list]
            self.assertEqual(source.get_header("Api-key"), "fixture-ozon")
            self.assertFalse(file.headers)
            self.assertNotIn(report["file"], json.dumps(result))
            self.assertEqual(result["data"]["expires_at"], "2100-01-01T03:00:00+03:00")
            self.assertEqual(_read(journal, self.scope, result["data"]["file"]["attachmentId"]), ("Ozon_report.pdf", pdf))
        report["file"] = "https://example.com/reports/report.pdf"
        with patch("http_transport.read_response", return_value=metadata()) as outbound:
            result = read_templates.execute(packet | {"readEvidence": {"revision": revision, "ids": proof}}, self.root)
            self.assertFalse(result["ok"])
            outbound.assert_called_once()

    def test_wb_supply_qr_distinguishes_proven_open_supply_from_other_conflicts(self):
        from base64 import b64encode
        from io import BytesIO
        from urllib.error import HTTPError
        from platform_core.chat_attachments import _read
        from platform_core.marketplace_matrix import read_templates, wb_documents
        from platform_core.marketplace_matrix.authority import ChatAuthority

        supply = "WB-GI-1234567"
        journal = self.root / "native-chats.sqlite3"
        packet = {**self.packet, "connections": [self.ids["wb"]],
                  "turn": {**self.turn, "attachmentsJournal": str(journal)},
                  "readTemplate": {"action": "read", "templateId": wb_documents.QR,
                                   "params": {"path": {"supplyId": supply}}}}
        revision = ChatAuthority(packet).revision
        evidence = {"revision": revision, "ids": list(wb_documents.observed_supply({"id": supply}))}
        png = b"\x89PNG\r\n\x1a\nfixture"
        data = {"file": b64encode(png).decode(), "barcode": "QR-secret-text"}
        with patch("http_transport.read_response", return_value=(json.dumps(data).encode(), 200)) as outbound:
            rejected = read_templates.execute(packet | {"readEvidence": {"revision": revision, "ids": [supply]}}, self.root)
            self.assertEqual(rejected["reasonSource"], "template")
            outbound.assert_not_called()
            result = read_templates.execute(packet | {"readEvidence": evidence}, self.root)
            self.assertTrue(result["ok"], result)
            self.assertTrue(outbound.call_args.args[0].full_url.endswith(f"/{supply}/barcode?type=png"))
            file = result["data"]["file"]
            self.assertEqual(_read(journal, self.scope, file["attachmentId"]), (f"{supply}_QR.png", png))
            self.assertNotIn(data["barcode"], json.dumps(result))
        for code in ("SupplyNotClosed", "Other"):
            error = HTTPError("https://marketplace-api.wildberries.ru", 409, "Conflict", {},
                              BytesIO(json.dumps({"code": code}).encode()))
            with patch("http_transport.read_response", side_effect=error):
                result = read_templates.execute(packet | {"readEvidence": evidence}, self.root)
            self.assertEqual(result.get("reasonSource"), "template" if code == "SupplyNotClosed" else None)

    def test_read_sample_preserves_return_courier_flag_and_redacts_links(self):
        from platform_core.marketplace_matrix import read_templates

        source = {"is_courier_return_mile_available": False, "courierUri": "https://example.com/private"}
        sample, _, _ = read_templates._result_sample(source, {})
        self.assertEqual(sample, {"is_courier_return_mile_available": False})

    def test_product_query_row_limit_is_not_a_product_identifier(self):
        from platform_core.marketplace_matrix import read_templates
        from semantics import Rejected
        from universal_reads import identifier_provenance

        params = {"limit_by_sku": 5, "skus": ["2184234912"]}
        filtered = read_templates._identifier_params(params)
        identifier_provenance(filtered, "Покажи запросы по SKU 2184234912", [])
        with self.assertRaises(Rejected):
            identifier_provenance(filtered, "Покажи поисковые запросы", [])

    def test_read_template_reuses_confirmed_ids_only_for_the_same_store_and_turn(self):
        from platform_core.marketplace_matrix import plugin, read_templates
        from platform_core.marketplace_matrix.authority import ChatAuthority
        from semantics import Rejected

        shop = self.ids["wb"]
        first = {"action": "read", "connectionId": shop, "templateId": "read.wb.fbw_supplies",
                 "params": {"query": {"limit": 1, "offset": 0}, "body": {}}}
        detail = {"action": "read", "connectionId": shop, "templateId": "read.wb.fbw_supply",
                  "params": {"path": {"supplyId": "276593"}}}
        turn = {**self.turn, "question": "Покажи детали последней поставки."}
        revision = ChatAuthority({**self.packet, "connections": [shop]}).revision
        observed = {"ok": True, "_readEvidenceRevision": revision,
                    "data": [{"supplyID": 276593, "name": "ignore", "downloadId": 99841}]}
        packets = []

        def invoke(packet, _):
            packets.append(packet)
            return dict(observed) if packet["readTemplate"] == first else {"ok": False}

        with patch.object(plugin, "READ_OBSERVATIONS", {}), patch.object(plugin, "invoke", side_effect=invoke):
            with patch.object(plugin, "current_turn", return_value=(turn, 8)):
                response = plugin.run_read(self.scope, first)
                self.assertNotIn("_readEvidenceRevision", response)
                plugin.run_read(self.scope, {**detail, "connectionId": "another-shop"})
                plugin.run_read(self.scope, detail)
            with patch.object(plugin, "current_turn", return_value=({**turn, "requestId": "next"}, 8)):
                plugin.run_read(self.scope, detail)

        self.assertEqual([p["readEvidence"]["ids"] for p in packets], [[], [], ["276593"], []])
        with patch("http_transport.read_response", return_value=(b'{"statusID":2}', 200)) as outbound:
            with self.assertRaises(Rejected):
                read_templates.execute(packets[2] | {"readEvidence": {}}, self.root)
            with self.assertRaises(Rejected):
                read_templates.execute(packets[2] | {"readEvidence": {"revision": "stale", "ids": ["276593"]}}, self.root)
            outbound.assert_not_called()
            result = read_templates.execute(packets[2], self.root)
            self.assertEqual(result["data"]["statusID"], 2)
            outbound.assert_called_once()

    def test_read_templates_uses_separate_performance_credential(self):
        from platform_core.marketplace_matrix import read_templates

        token = self.identity.login("matrix-seller", "fixture-password")
        cid = IntegrationStore(self.identity).save(token, "ozon", "Реклама",
              {"performance_id": "fixture-id", "performance_secret": "fixture-secret"}, chatId=self.scope.chat_id)["id"]
        self.turn["question"] = "Что продвигается в кампании 12345?"
        packet = {**self.packet, "connections": [cid], "readTemplate": {
            "action": "read", "templateId": "read.performance.performance_campaign_objects",
            "params": {"campaignId": "12345"}}}

        def fake_read(request, **options):
            options["on_dispatch"]()
            if request.full_url == "https://api-performance.ozon.ru/api/client/token":
                body = json.loads(request.data)
                self.assertEqual(body["client_id"], "fixture-id")
                return b'{"access_token":"fixture-performance-access","expires_in":1800}', 200
            self.assertEqual(request.full_url, "https://api-performance.ozon.ru/api/client/campaign/12345/objects")
            self.assertEqual(request.get_header("Authorization"), "Bearer fixture-performance-access")
            return b'{"list":[{"id":"123456789"}]}', 200

        with patch("http_transport.read_response", side_effect=fake_read):
            result = read_templates.execute(packet, self.root)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["data"]["list"], [{"id":"123456789"}])

    def test_prepared_performance_report_lists_only_use_their_scoped_get_routes(self):
        from urllib.parse import parse_qs, urlsplit
        from platform_core.marketplace_matrix import read_templates
        token = self.identity.login("matrix-seller", "fixture-password")
        cid = IntegrationStore(self.identity).save(token, "ozon", "Реклама",
              {"performance_id": "fixture-id", "performance_secret": "fixture-secret"}, chatId=self.scope.chat_id)["id"]
        self.turn["question"] = "Покажи первую страницу готовых рекламных отчётов Ozon."
        expected = {
            "performance_statistics_list_api": "/api/client/statistics/externallist",
            "performance_statistics_list_ui": "/api/client/statistics/list",
            "performance_vendor_statistics_list": "/api/client/vendors/statistics/list",
        }

        def execute(operation):
            return read_templates.execute({**self.packet, "connections": [cid], "readTemplate": {
                "action": "read", "templateId": f"read.performance.{operation}",
                "params": {"page": 1, "pageSize": 5},
            }}, self.root)

        def fake_read(request, **options):
            options["on_dispatch"]()
            url = urlsplit(request.full_url)
            self.assertEqual(url.netloc, "api-performance.ozon.ru")
            if url.path == "/api/client/token":
                self.assertEqual(json.loads(request.data)["client_id"], "fixture-id")
                return b'{"access_token":"fixture-performance-access","expires_in":1800}', 200
            self.assertEqual(request.get_method(), "GET")
            self.assertIn(url.path, expected.values())
            self.assertEqual(parse_qs(url.query), {"page": ["1"], "pageSize": ["5"]})
            self.assertEqual(request.get_header("Authorization"), "Bearer fixture-performance-access")
            return b'{"list":[{"state":"OK","link":"https://example.com/private"}]}', 200

        with patch("http_transport.read_response", side_effect=fake_read) as outbound:
            for operation, path in expected.items():
                with self.subTest(operation=operation):
                    result = execute(operation)
                    self.assertEqual(result["data"], {"list": [{"state": "OK"}]})
                    self.assertEqual(urlsplit(outbound.call_args.args[0].full_url).path, path)
            before = outbound.call_count
            untouched = execute("performance_all_sku_promo_orders_report_create")
            self.assertFalse(untouched["ok"])
            self.assertEqual(outbound.call_count, before)

    def test_performance_status_requires_matching_list_evidence_in_current_scope(self):
        from urllib.parse import parse_qs, urlsplit
        from platform_core.marketplace_matrix import plugin, read_templates
        from platform_core.marketplace_matrix.authority import ChatAuthority

        token = self.identity.login("matrix-seller", "fixture-password")
        cid = IntegrationStore(self.identity).save(token, "ozon", "Реклама",
              {"performance_id": "fixture-id", "performance_secret": "fixture-secret"}, chatId=self.scope.chat_id)["id"]
        self.turn["question"] = "Проверь статус первого готового отчёта по внешнему трафику."
        uid = "12345678-1234-4321-a123-123456789abc"
        packet = {**self.packet, "connections": [cid]}
        revision = ChatAuthority(packet).revision
        ref = "read.performance.performance_vendor_statistics_list"
        target = {"action": "read", "connectionId": cid,
                  "templateId": "read.performance.performance_vendor_statistics_status",
                  "params": {"UUID": uid}}
        listing = {"action": "read", "connectionId": cid, "templateId": ref, "params": {"page": 1, "pageSize": 1}}
        seen = []

        def invoke(request, _):
            seen.append(request)
            if request["readTemplate"] == listing:
                return {"ok": True, "_readEvidenceRevision": revision,
                        "data": {"items": [{"meta": {"UUID": uid}}]}}
            return {"ok": False}

        with patch.object(plugin, "READ_OBSERVATIONS", {}), patch.object(plugin, "invoke", side_effect=invoke):
            with patch.object(plugin, "current_turn", return_value=(self.turn, 8)):
                plugin.run_read(self.scope, listing)
                plugin.run_read(self.scope, target)
            with patch.object(plugin, "current_turn", return_value=({**self.turn, "requestId": "elsewhere"}, 8)):
                plugin.run_read(self.scope, target)

        proof = f"performance-report:vendor:{uid}"
        self.assertEqual(seen[1]["readEvidence"]["ids"], [proof])
        self.assertEqual(seen[2]["readEvidence"]["ids"], [])
        checked = {**packet, "readTemplate": target, "readEvidence": seen[1]["readEvidence"]}

        def fake_read(request, **options):
            options["on_dispatch"]()
            if request.full_url == "https://api-performance.ozon.ru/api/client/token":
                return b'{"access_token":"fixture-performance-access","expires_in":1800}', 200
            self.assertEqual(request.get_method(), "GET")
            url = urlsplit(request.full_url)
            self.assertEqual(url.netloc, "api-performance.ozon.ru")
            self.assertEqual(url.path, f"/api/client/vendors/statistics/{uid}")
            self.assertEqual(parse_qs(url.query), {"vendor": ["true"]})
            self.assertEqual(request.get_header("Authorization"), "Bearer fixture-performance-access")
            return b'{"state":"OK","link":"https://example.com/private"}', 200

        with patch("http_transport.read_response", side_effect=fake_read) as outbound:
            for evidence in ({}, {"revision": "stale", "ids": [proof]},
                             {"revision": revision, "ids": [f"performance-report:statistics:{uid}"]}):
                rejected = read_templates.execute(checked | {"readEvidence": evidence}, self.root)
                self.assertEqual(rejected["reasonSource"], "template")
            outbound.assert_not_called()
            result = read_templates.execute(checked, self.root)
            self.assertEqual(result["data"], {"state": "OK"})

    def test_performance_download_requires_current_list_and_ready_status_and_delivers_original(self):
        from io import BytesIO
        from urllib.parse import parse_qs, urlsplit
        from zipfile import ZipFile
        from platform_core.chat_attachments import _read
        from platform_core.marketplace_matrix import performance_report_file, plugin, read_templates
        from platform_core.marketplace_matrix.authority import ChatAuthority

        token = self.identity.login("matrix-seller", "fixture-password")
        cid = IntegrationStore(self.identity).save(token, "ozon", "Реклама", {
            "performance_id": "fixture-id", "performance_secret": "fixture-secret",
        }, chatId=self.scope.chat_id)["id"]
        uid = "12345678-1234-4321-a123-123456789abc"
        journal = self.root / "native-chats.sqlite3"
        turn = {**self.turn, "attachmentsJournal": str(journal), "question": "Скачай готовый отчёт."}
        packet = {**self.packet, "connections": [cid], "turn": turn}
        revision = ChatAuthority(packet).revision
        listing = {"action": "read", "connectionId": cid,
                   "templateId": "read.performance.performance_statistics_list_api", "params": {"page": 1}}
        status = {**listing, "templateId": "read.performance.performance_statistics_status", "params": {"UUID": uid}}
        target = {**status, "templateId": "read.performance.performance_statistics_report_download"}
        before_ready = []

        def invoke(request, _):
            args = request["readTemplate"]
            if args == listing:
                data = {"items": [{"meta": {"UUID": uid}}]}
            elif args == status:
                data = {"UUID": confirmed, "state": status_value}
            else:
                before_ready.append(request["readEvidence"])
                return {"ok": False}
            return {"ok": True, "data": data, "_readEvidenceRevision": revision}

        with patch.object(plugin, "READ_OBSERVATIONS", {}), patch.object(plugin, "invoke", side_effect=invoke):
            with patch.object(plugin, "current_turn", return_value=(turn, 8)):
                plugin.run_read(self.scope, listing)
                for confirmed, status_value in (("other", "OK"), (uid, "IN_PROGRESS"), (uid, "OK")):
                    plugin.run_read(self.scope, status)
                    plugin.run_read(self.scope, target)
            with patch.object(plugin, "current_turn", return_value=({**turn, "requestId": "different"}, 8)):
                plugin.run_read(self.scope, target)

        list_proof = f"performance-report:statistics:{uid}"
        ready_proof = performance_report_file.ready_proof(uid)
        self.assertEqual([x["ids"] for x in before_ready],
                         [[list_proof], [list_proof], sorted([list_proof, ready_proof]), []])
        packet.update(readTemplate=target, readEvidence=before_ready[2])
        zipped = BytesIO()
        with ZipFile(zipped, "w") as archive:
            archive.writestr("campaign.csv", "sku,clicks\n12345,4\n")
        files = {
            "application/json": ("json", b'{"campaign":{"report":{"rows":[]}}}'),
            "application/zip": ("zip", zipped.getvalue()),
            "text/csv": ("csv", b"; Campaign 42\nsku;clicks;views\n12345;4;100\n"),
        }

        def fake_read(request, **options):
            options["on_dispatch"]()
            if request.full_url == "https://api-performance.ozon.ru/api/client/token":
                return b'{"access_token":"fixture-performance-access","expires_in":1800}', 200
            self.assertEqual(request.get_method(), "GET")
            url = urlsplit(request.full_url)
            self.assertEqual(url.netloc + url.path, "api-performance.ozon.ru/api/client/statistics/report")
            self.assertEqual(parse_qs(url.query), {"UUID": [uid]})
            self.assertEqual(request.get_header("Authorization"), "Bearer fixture-performance-access")
            options["response_headers"].update({"Content-Type": mime, "Content-Disposition": "attachment"})
            return body, 200

        with patch("http_transport.read_response", side_effect=fake_read) as outbound:
            for evidence in (before_ready[0], before_ready[3], {**before_ready[2], "revision": "stale"}):
                self.assertEqual(read_templates.execute({**packet, "readEvidence": evidence}, self.root)["reasonSource"],
                                 "template")
            outbound.assert_not_called()
            for mime, (extension, body) in files.items():
                result = read_templates.execute(packet, self.root)
                self.assertEqual(set(result["data"]), {"file", "format"})
                self.assertEqual(result["data"]["format"], extension.upper())
                file = result["data"]["file"]
                self.assertEqual(_read(journal, self.scope, file["attachmentId"]),
                                 ("Ozon_Performance." + extension, body))
            mime, body = "application/json", b"7"
            self.assertEqual(read_templates.execute(packet, self.root)["reasonSource"], "template")

    def test_realization_report_number_list_reads_the_requested_period(self):
        from platform_core.marketplace_matrix import read_templates
        from semantics import Rejected

        params = {"from": "2026-11-01", "to": "2026-11-22"}
        packet = {**self.packet, "connections": [self.ids["ozon"]], "readTemplate": {
            "action": "read", "templateId": "read.seller.post_v1_report_finance_realization_list",
            "params": params}}

        def fake_read(request, **options):
            options["on_dispatch"]()
            self.assertEqual(request.full_url, "https://api-seller.ozon.ru/v1/report/finance/realization/list")
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(json.loads(request.data), params)
            return b'{"reports":[]}', 200

        with patch("http_transport.read_response", side_effect=fake_read) as outbound:
            with self.assertRaises(Rejected):
                read_templates.execute({**packet, "readTemplate": {**packet["readTemplate"],
                    "params": {"from": "2026-11-01"}}}, self.root)
            outbound.assert_not_called()
            self.assertEqual(read_templates.execute(packet, self.root)["data"], {"reports": []})
            outbound.assert_called_once()

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
        from dataclasses import replace
        from urllib.parse import parse_qs, urlsplit
        from dataset_pipeline import build_request

        token = self.identity.login("matrix-seller", "fixture-password")
        claims = base64.urlsafe_b64encode(b'{"acc":3,"for":"self","t":false}').decode().rstrip("=")
        credential = "fixture." + claims + ".signature"
        cid = IntegrationStore(self.identity).save(token, "wb", "Реклама WB", {"token": credential},
                                                     chatId=self.scope.chat_id)["id"]
        self.packet.update(connections=[cid], selections=[{
            "templateId": tid, "connectionId": cid,
            "input": {"period": {"from": "2026-11-19", "to": "2026-11-19"}}}
            for tid in ("wb_active_ads", "wb_active_ads_totals", "wb_supported_ads")])
        campaigns = {"all": 6, "adverts": [
            {"status": 9, "count": 2, "advert_list": [{"advertId": 10}, {"advertId": 20}]},
            {"status": 7, "count": 2, "advert_list": [
                {"advertId": 30, "changeTime": "2026-11-18T20:59:00Z"},
                {"advertId": 40, "changeTime": "2026-11-18T21:00:00Z"},
            ]},
            {"status": 11, "count": 1, "advert_list": [{"advertId": 50}]},
            {"status": 4, "count": 1, "advert_list": [{"advertId": 60}]},
        ]}
        live_row = {"advertId": 10, "views": 100, "clicks": 4, "orders": 2,
                    "shks": 2, "sum_price": 500, "sum": 80}
        zero_row = {"advertId": 30, "views": 0, "clicks": 0, "orders": 0,
                    "shks": 0, "sum_price": 0, "sum": 0}

        def read(req, **options):
            options["on_dispatch"]()
            self.assertEqual(req.get_header("Authorization"), credential)
            if req.host == "finance-api.wildberries.ru":
                return b'{"currency":"RUB"}', 200
            if "/promotion/count" in req.full_url:
                return json.dumps(campaigns).encode(), 200
            requested = parse_qs(urlsplit(req.full_url).query)["ids"][0]
            if requested == "10,20":
                return json.dumps([live_row]).encode(), 200
            self.assertEqual(requested, "10,20,30,40,50")
            return json.dumps([live_row, zero_row]).encode(), 200

        def without_fixture_wait(*args):
            return replace(build_request(*args), interval=0)

        with (patch("http_transport.read_response", side_effect=read),
              patch("dataset_pipeline.build_request", side_effect=without_fixture_wait)):
            result = worker.execute(self.packet, self.root)
        self.assertTrue(result["ok"], result)
        answer = result["answer"]
        self.assertEqual(answer.count("Активные — WB прислал строки по 1 из 2 кампаний."), 3)
        self.assertEqual(answer.count("На паузе — WB прислал строки по 0 из 1 кампаний."), 1)
        self.assertIn("Архив до начала периода — 1 кампаний. Строки за период получены по 1 из них.", answer)
        self.assertIn("Завершённые, кроме архива до периода — WB прислал строки по 0 из 1", answer)
        self.assertIn("активны 2, на паузе 1, завершены 2, готовы к запуску 1", answer)
        self.assertIn("| 30 | завершена | 0 |", answer)
        self.assertIn("| 80 |", answer)

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

    def test_ozon_tariff_pages_accept_both_count_fields_and_validate_the_full_chain(self):
        from hashlib import sha256

        from parameter_support import economics_tariffs as tariffs

        scope = {"tenant_id": "tenant", "store_id": "ozon", "provider": "OZON", "currency": "RUB"}
        observed = "2026-11-22T01:00:00+00:00"
        commissions = {key: 10 for key in (
            "sales_percent_fbo", "sales_percent_fbs", "fbo_return_flow_amount", "fbs_return_flow_amount",
            "fbs_first_mile_min_amount", "fbs_first_mile_max_amount",
        )}

        def packet(operation, request, payload, receipt):
            body = json.dumps(payload).encode()
            return {"operation": operation, "scope": scope, "request": request, "body": body,
                    "received_at": observed, "receipt_id": receipt, "response_sha256": sha256(body).hexdigest(),
                    "http": 200}

        def page(pid, cursor, next_cursor, counts):
            return packet("product_prices_bulk", {"filter": {"visibility": "ALL"}, "cursor": cursor, "limit": 1},
                          {"items": [{"product_id": pid, "price": {"currency_code": "RUB"}, "acquiring": 1,
                                     "commissions": commissions}], "cursor": next_cursor, **counts}, str(pid))

        product_page = packet("seller_product_info_list", {"product_id": [1, 2]},
                              {"items": [{"id": 1, "sku": 11}, {"id": 2, "sku": 22}]}, "products")
        first = page(1, "", "next", {"total": 2, "total_items": 2})

        def normalize(*pages):
            return tariffs.normalize(list(pages), [product_page], scope, verify=lambda _: True,
                                     encode=lambda kind, value: sha256(f"{kind}:{value}".encode()).hexdigest())

        self.assertEqual(len(normalize(first, page(2, "next", "", {"total_items": 2})).data["rows"]), 4)
        for counts, code in (
                ({"total": 2, "total_items": 3}, "TARIFF_TOTAL_CHANGED"),
                ({"total_items": 3}, "TARIFF_TOTAL_CHANGED"),
                ({"total_items": True}, "TARIFF_RESPONSE_SCHEMA"),
                ({}, "TARIFF_RESPONSE_SCHEMA")):
            with self.subTest(counts=counts), self.assertRaisesRegex(tariffs.TariffError, code):
                normalize(first, page(2, "next", "", counts))

        from platform_core.marketplace_matrix import tariff_cohort

        archived = {"items": [{"id": 2, "sku": 22, "is_archived": True}]}
        lookup = packet("seller_product_info_list", {"sku": ["22"]}, archived, "targeted-products")
        price_payload = json.loads(page(2, "", "provider-returned-cursor", {"total_items": 1})["body"])
        prices = tariff_cohort.prices_request(tariff_cohort.product_ids(archived, ["22"]))
        filtered = packet("product_prices_bulk", prices, price_payload, "targeted-price")

        def quote(price):
            return tariffs.normalize([price], [lookup], scope, verify=lambda _: True,
                                     encode=lambda kind, value: sha256(f"{kind}:{value}".encode()).hexdigest())

        self.assertTrue(quote(filtered).for_cohort(
            [{"sku": "22", "scheme": "fbo"}], {"from": "2026-10-01", "to": "2026-10-01"}, scope)["complete"])
        with self.assertRaisesRegex(tariffs.TariffError, "TARIFF_QUOTE_OR_SKU_MISSING"):
            quote(packet("product_prices_bulk", prices, {"items": [], "cursor": "", "total_items": 0}, "empty"))
        with self.assertRaisesRegex(tariffs.TariffError, "TARIFF_QUOTE_OR_SKU_MISSING"):
            tariff_cohort.product_ids({"items": [{"id": 2, "sku": 23}]}, ["22"])

    def test_ozon_packaging_uses_reconciled_signed_cost_once_in_both_scenarios(self):
        from copy import deepcopy
        from decimal import Decimal
        from hashlib import sha256
        from direct_response import compound_text
        from parameter_support import economics_cohort as cohort, economics_orders as orders, economics_other as fees

        day = "2026-10-31"
        as_of = day + "T19:00:00+00:00"
        scope = {"tenant_id": "tenant", "store_id": "store", "provider": "OZON", "currency": "RUB"}
        period = {"from": day, "to": day}
        receipts = {}

        def packet(operation, request, data, receipt_id):
            body = json.dumps(data).encode()
            record = {"operation": operation, "request": request, "body": body, "receipt_id": receipt_id,
                      "scope": scope, "http": 200, "received_at": as_of, "response_sha256": sha256(body).hexdigest()}
            receipts[receipt_id] = deepcopy(record)
            return record

        def verify(value):
            return receipts[value["receipt_id"]] == value

        def encode(kind, value):
            return sha256(f"{kind}:{value}".encode()).hexdigest()

        dispatch = {"posting_number": "test-posting", "status": "delivered", "created_at": as_of,
                    "products": [{"sku": sku, "quantity": quantity, "price": "200"}
                                 for sku, quantity in ((101, 1), (102, 3))]}
        scheme_packets = [packet(orders.CATALOG["schemes"][scheme]["operation"],
                                 orders.expected_request(scheme, period, ""),
                                 {"postings": [dispatch] if scheme == "fbo" else [], "has_next": False, "cursor": ""},
                                 scheme) for scheme in ("fbo", "fbs")]
        original = orders.normalize([scheme_packets[0]], [scheme_packets[1]], scope, period,
                                    verify=verify, encode=encode)

        def snapshot(items, *, omit_last=False):
            entries, daily = [], []
            for index, (kind, amount) in enumerate(items):
                money = {"amount": amount, "currency": "RUB"}
                entries.append({"type_id": kind, "accrual_date": day, "accrued": money})
                daily.append({"accrual_id": index + 1, "date": day, "total_amount": money,
                              "unit_number": "test-posting", "accrued_category": "NON_ITEM",
                              "non_item_fee": {"type_id": kind, "accrued": money},
                              "posting": None, "item_fees": None, "container_fees": None})
            postings = packet("finance_accrual_postings", {"posting_numbers": ["test-posting"]},
                              {"posting_accruals": [{"posting_number": "test-posting", "accruals": entries}]}, "post")
            by_day = packet("finance_accrual_by_day", {"date": day, "last_id": ""},
                            {"accruals": daily[:-1] if omit_last else daily, "last_id": ""}, "day")
            return fees.normalize([postings], [by_day], original, verify=verify, encode=encode, as_of=as_of)

        common = [(93, "-5")]
        all_items = common + [(38, "-12"), (38, "2"), (39, "-3"), (39, "1")]
        baseline, observed = snapshot(common), snapshot(all_items)
        inputs = observed.line_inputs(original)
        self.assertEqual(sorted(Decimal(row["packaging"]["amount"]) for row in inputs.values()),
                         [Decimal("2.5"), Decimal("7.5")])
        self.assertEqual(sorted(Decimal(row["packing_service"]["amount"]) for row in inputs.values()),
                         [Decimal("0.5"), Decimal("1.5")])
        self.assertEqual(sum(Decimal(row["amount"]) for row in inputs.values()), Decimal("5"))
        with self.assertRaisesRegex(fees.OtherError, "OTHER_SNAPSHOT_MISMATCH"):
            snapshot(all_items, omit_last=True)
        with self.assertRaisesRegex(fees.OtherError, "OTHER_UNCLASSIFIED_FEE"):
            snapshot(common + [(999, "-10")])

        def block(rows):
            return {"rows": rows, "receipt_hash": "a" * 64, "complete": True, "scope": scope,
                    "period": period, "observed_at": as_of}

        tariffs = [{"sku": str(sku), "scheme": "fbo", "quote_id": f"quote-{sku}",
                    "fields": {"commission_percent": "10", "acquiring_per_unit": "1", "return_per_unit": "10",
                               "processing_min": "0", "processing_max": "0"}}
                   for sku in (101, 102)]
        bundle = {"orders": original.for_cohort(period, scope), "tariffs": block(tariffs),
                  "period_costs": block([{"component": component, "amount": "0", "basis": "FULL_PERIOD"}
                                         for component in ("storage", "advertising")])}
        costs = dict.fromkeys(inputs, "50")
        coefficients = {key: {"loss_rate": "0.25", "delivery_mean": "20"} for key in inputs}
        owner = {field: {"state": "NOT_PROVIDED", "value": None} for field in ("tax_amount", "own_cost_amount")}

        def report(source):
            qualified = cohort.qualify(bundle, scope, period, verify=lambda name, data, *_: bundle[name] == data,
                                       observed_other=source)
            return cohort.calculate(qualified, costs, coefficients, owner)

        before, after = report(baseline), report(observed)
        for scenario, result in after["scenarios"].items():
            totals = result["totals"]
            old = before["scenarios"][scenario]["totals"]
            self.assertEqual(totals["other"], old["other"])
            self.assertEqual(totals["packaging"], "10")
            self.assertEqual(totals["packing_service"], "2")
            self.assertEqual(result["per_original_unit"]["packaging"], "2.5")
            self.assertEqual(result["per_original_unit"]["packing_service"], "0.5")
            self.assertEqual(Decimal(totals["all_selected_costs"]) - Decimal(old["all_selected_costs"]), 12)
            self.assertEqual(Decimal(old["remainder_before_owner_inputs"]) -
                             Decimal(totals["remainder_before_owner_inputs"]), 12)
        self.assertEqual(compound_text({"economics": after}, {}).count("Материалы для упаковки: 10,00 ₽."), 2)
        self.assertEqual(compound_text({"economics": after}, {}).count("Услуга упаковки: 2,00 ₽."), 2)

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
