"""Synthetic fixtures only; no credentials, accounts, or provider traffic are real."""
from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from application import Application
from config import Config, read_json
import connectors
from errors import LabError
from ledger import Ledger

CORE = Path(os.environ.get("HARNESS_TEST_CORE_ROOT", ROOT.parents[1] / "harness-reference" / "core")).resolve()
SECRET = "SYNTHETIC-KEY-NEVER-A-REAL-CREDENTIAL"


def write(path, value, mode=0o600):
    path.write_text(json.dumps(value))
    path.chmod(mode)


class LabTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.key = self.root / "key.json"
        write(self.key, {"api_key": SECRET, "folder_id": "synthetic-folder"})
        self.config = self.root / "config.json"
        self.definition = {"schema": "harness-lab-connectors/v1", "scope_id": "synthetic-owner-a", "revision": "v1",
                           "yandex": {"enabled": True, "credential_file": str(self.key), "max_daily_requests": 20},
                           "ozon": {"enabled": False}}
        self.save()
        self.calls = []
        self.response = {"totalCount": "17", "results": [{"phrase": "synthetic phrase", "count": "5"}],
                         "associations": [{"phrase": "synthetic associated", "count": "2"}], "private_extra": SECRET}
        self.status = 200
        self.now = 1_800_000_000.0
        self.ledger = Ledger(self.root / "state", clock=lambda: self.now)

        def handler(request):
            self.calls.append(request)
            return httpx.Response(self.status, json=self.response)
        self.transport = httpx.MockTransport(handler)
        self.app = Application(self.config, self.root / "state", transport=self.transport, ledger=self.ledger)

    def save(self):
        write(self.config, self.definition)

    def tearDown(self):
        self.tmp.cleanup()

    async def phrases(self, **kwargs):
        return await self.app.call("yandex_collect_phrases", {"phrase": "synthetic seed", **kwargs})

    def ozon_setup(self):
        if not CORE.is_dir():
            self.fail("Set HARNESS_TEST_CORE_ROOT to the actual reviewed matrix source; native checks must not be skipped")
        scalars, _, _ = connectors.native_modules(str(CORE))
        from registry import REGISTRY_HASH
        self.native_file = self.root / "native.json"
        self.native = {"execution_enabled": True,
                       "accounts": {"synthetic-account": {"active": True, "stores": [{"id": "synthetic-store", "platform": "ozon",
                           "identity": "synthetic-cabinet", "access_revision": "fixture1", "source_revision": "fixture1", "currency": "RUB"}]}},
                       "qualifications": {"ozon_orders": {"status": "READ_ONLY_CANARY", "registry_hash": REGISTRY_HASH,
                           "scalar_hash": scalars.MATRIX.hash, "evidence_ref": "SYNTHETIC-TEST-FIXTURE-NOT-LIVE-PROOF"}}}
        write(self.native_file, self.native)
        ozon_key = self.root / "ozon.json"
        write(ozon_key, {"seller_client_id": "SYNTHETIC-CLIENT", "seller_api_key": SECRET})
        self.definition["ozon"] = {"enabled": True, "credential_file": str(ozon_key), "max_daily_requests": 50,
                                  "core_root": str(CORE), "native_runtime_file": str(self.native_file),
                                  "native_store_id": "synthetic-store"}
        self.save()
        self.response = {"result": {"data": [{"dimensions": [{"id": "2026-10"}], "metrics": [17, 2500.25]}],
                                     "totals": [17, 2500.25]}, "private_extra": SECRET}

    async def orders(self, **kwargs):
        return await self.app.call("marketplace_orders_report", {"date_from": "2026-10-01", "date_to": "2026-10-02", **kwargs})

    def stocks_setup(self):
        self.ozon_setup()
        self.native["qualifications"]["ozon_stocks"] = deepcopy(self.native["qualifications"]["ozon_orders"])
        write(self.native_file, self.native)
        self.response = {"items": [{"product_id": 101, "offer_id": "synthetic-offer", "stocks": [
            {"type": "fbo", "sku": 201, "shipment_type": "SHIPMENT_TYPE_GENERAL", "present": 7, "reserved": 2},
            {"type": "fbs", "sku": 202, "shipment_type": "SHIPMENT_TYPE_GENERAL", "present": 11, "reserved": 3}
        ]}], "total_items": 1, "cursor": ""}

    async def test_yandex_exact_contract_and_closed_response(self):
        result = await self.phrases(limit=3, regions=["213"], device="phone")
        self.assertEqual(len(self.calls), 1)
        sent = self.calls[0]
        self.assertEqual(str(sent.url), connectors.YANDEX_URL)
        self.assertEqual(sent.headers["authorization"], "Api-Key " + SECRET)
        self.assertEqual(json.loads(sent.content), {"phrase": "synthetic seed", "numPhrases": 3,
            "regions": ["213"], "devices": ["DEVICE_PHONE"], "folderId": "synthetic-folder"})
        self.assertEqual(result["schema"], "harness-lab-tool-result/v1")
        self.assertEqual(result["kind"], "data")
        self.assertEqual(result["data"]["phrases"][0]["count"], 5)
        self.assertEqual(result["data"]["statistics_available_through"], "2026-10-07")
        self.assertNotIn(SECRET, json.dumps(result))
        self.assertNotIn(SECRET.encode(), self.ledger.path.read_bytes())

    async def test_exact_cache_survives_restart(self):
        first = await self.phrases()
        self.app = Application(self.config, self.root / "state", transport=self.transport,
                               ledger=Ledger(self.root / "state", clock=lambda: self.now))
        again = await self.phrases()
        self.assertEqual(len(self.calls), 1)
        self.assertTrue(again["cache"]["hit"])
        self.assertEqual(again["as_of"], first["as_of"])
        self.assertEqual(again["execution"]["provider_requests_this_call"], 0)

    async def test_disabled_is_not_connected_not_fake(self):
        self.definition["yandex"] = {"enabled": False}
        self.save()
        with self.assertRaises(LabError) as caught:
            await self.phrases()
        self.assertEqual(caught.exception.code, "CONNECTOR_DISABLED")
        cap = await self.app.call("lab_capabilities", {})
        self.assertEqual(cap["kind"], "capabilities")
        self.assertFalse(cap["data"]["connectors"][0]["enabled"])
        self.assertEqual(cap["data"]["connectors"][0]["configuration_status"], "not_configured")
        self.assertEqual(self.calls, [])

    async def test_capabilities_never_claims_a_verified_connection(self):
        self.key.unlink()
        item = self.app.capabilities()["data"]["connectors"][0]
        self.assertTrue(item["enabled"])
        self.assertFalse(item["connection_checked"])
        self.assertEqual(item["configuration_status"], "operator_enabled")
        self.assertNotIn("connected", item)
        self.assertEqual(self.calls, [])

    async def test_revocation_rechecked_before_cache(self):
        await self.phrases()
        self.definition["yandex"] = {"enabled": False}
        self.save()
        with self.assertRaises(LabError):
            await self.phrases()
        self.assertEqual(len(self.calls), 1)

    async def test_missing_credential_does_not_serve_cached_private_data(self):
        await self.phrases()
        self.key.unlink()
        with self.assertRaises(LabError):
            await self.phrases()
        self.assertEqual(len(self.calls), 1)

    async def test_model_cannot_select_credentials_account_or_url(self):
        for extra in [{"tenant_id": "other"}, {"store_id": "other"}, {"credential_file": "/tmp/private"},
                      {"url": "http://127.0.0.1"}]:
            with self.assertRaises(LabError) as caught:
                await self.phrases(**extra)
            self.assertEqual(caught.exception.code, "UNKNOWN_ARGUMENT")
        self.assertEqual(self.calls, [])

    async def test_invalid_boundaries_never_dispatch(self):
        for args in [{"limit": True}, {"limit": 51}, {"regions": ["213", "213"]},
                     {"regions": ["-1"]}, {"device": "arbitrary"}, {"phrase": "api_key=" + SECRET}]:
            with self.assertRaises(LabError):
                await self.phrases(**args)
        self.assertEqual(self.calls, [])

    async def test_private_config_and_credentials_permissions(self):
        self.key.chmod(0o644)
        with self.assertRaises(LabError):
            await self.phrases()
        self.assertEqual(self.calls, [])
        self.key.chmod(0o600)
        self.config.chmod(0o644)
        with self.assertRaises(LabError):
            Config(self.config).read()

    async def test_systemd_readonly_group_credentials_only_in_trusted_mount(self):
        credential_root = self.root / "credentials"
        credential_root.mkdir(mode=0o750)
        mounted = credential_root / "test.json"
        write(mounted, {"synthetic": True}, 0o440)
        credential_root.chmod(0o550)
        try:
            with patch.dict(os.environ, {"HARNESS_LAB_CREDENTIALS_DIRECTORY": str(credential_root)}):
                self.assertEqual(read_json(mounted), {"synthetic": True})
                self.key.chmod(0o440)
                with self.assertRaises(LabError):
                    read_json(self.key)
                for mode in (0o444, 0o460, 0o640):
                    mounted.chmod(mode)
                    with self.assertRaises(LabError):
                        read_json(mounted)
        finally:
            credential_root.chmod(0o750)

    async def test_systemd_credential_scope_rejects_symlink_or_writable_parent(self):
        credential_root = self.root / "credentials"
        credential_root.mkdir(mode=0o750)
        mounted = credential_root / "test.json"
        mounted.symlink_to(self.key)
        self.key.chmod(0o440)
        with patch.dict(os.environ, {"CREDENTIALS_DIRECTORY": str(credential_root), "HARNESS_LAB_CREDENTIALS_DIRECTORY": ""}):
            with self.assertRaises(LabError):
                read_json(mounted)
            mounted.unlink()
            write(mounted, {"synthetic": True}, 0o440)
            credential_root.chmod(0o770)
            with self.assertRaises(LabError):
                read_json(mounted)

    async def test_http_error_never_echoes_body_or_retries(self):
        self.status = 401
        self.response = {"message": "Authorization: " + SECRET}
        for _ in range(2):
            with self.assertRaises(LabError) as caught:
                await self.phrases()
            self.assertEqual(caught.exception.code, "UPSTREAM_HTTP_401")
            self.assertNotIn(SECRET, json.dumps(caught.exception.public()))
        self.assertEqual(len(self.calls), 1)

    async def test_provider_limit_diagnostic_is_fixed_projection_and_cached(self):
        self.status = 429
        self.response = {"code": 8, "message": "You have reached request rate limit per second " + SECRET}
        for _ in range(2):
            with self.assertRaises(LabError) as caught:
                await self.phrases()
            public = caught.exception.public()
            self.assertEqual(public["provider_code"], 8)
            self.assertEqual(public["provider_reason"], "RATE_LIMIT_PER_SECOND")
            self.assertNotIn(SECRET, json.dumps(public))
        self.assertEqual(len(self.calls), 1)

    async def test_network_unknown_is_durable_and_never_replayed(self):
        def timeout(request):
            self.calls.append(request)
            raise httpx.ReadTimeout("sensitive network detail " + SECRET)
        self.app.transport = httpx.MockTransport(timeout)
        with self.assertRaises(LabError) as caught:
            await self.phrases()
        self.assertTrue(caught.exception.unknown)
        self.app = Application(self.config, self.root / "state", transport=self.transport, ledger=self.ledger)
        with self.assertRaises(LabError) as again:
            await self.phrases()
        self.assertEqual(again.exception.code, "OUTCOME_UNKNOWN_NO_REPLAY")
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn(SECRET.encode(), self.ledger.path.read_bytes())

    async def test_oversized_or_malformed_success_not_invented(self):
        self.response = {"totalCount": "unknown", "results": []}
        with self.assertRaises(LabError) as caught:
            await self.phrases()
        self.assertEqual(caught.exception.code, "UPSTREAM_SCHEMA")

    async def test_cache_is_scoped_to_owner(self):
        await self.phrases()
        self.definition["scope_id"] = "synthetic-owner-b"
        self.save()
        second = await self.phrases()
        self.assertFalse(second["cache"]["hit"])
        self.assertEqual(len(self.calls), 2)

    async def test_daily_cap_expires_and_has_retry_after(self):
        self.definition["yandex"]["max_daily_requests"] = 1
        self.save()
        await self.phrases()
        self.now += 2
        with self.assertRaises(LabError) as caught:
            await self.phrases(phrase="second synthetic seed")
        self.assertEqual(caught.exception.code, "LAB_DAILY_REQUEST_BUDGET")
        self.assertGreater(caught.exception.retry_after, 0)
        self.now += 86400
        await self.phrases(phrase="second synthetic seed")
        self.assertEqual(len(self.calls), 2)

    async def test_actual_native_matrix_requests_decodes_and_reconciles_totals(self):
        self.ozon_setup()
        value = await self.orders()
        self.assertEqual(value["data"]["ordered_units"], 17)
        self.assertEqual(value["data"]["ordered_revenue"], "2500.25")
        self.assertEqual(value["data"]["currency"], "RUB")
        sent = self.calls[0]
        self.assertEqual(str(sent.url), connectors.OZON_URL)
        self.assertEqual(json.loads(sent.content)["metrics"], ["ordered_units", "revenue"])
        self.assertEqual(json.loads(sent.content)["dimension"], ["month"])
        self.assertEqual(sent.headers["api-key"], SECRET)
        self.assertNotIn(SECRET, json.dumps(value))
        self.assertNotIn("synthetic-cabinet", json.dumps(value))

    async def test_native_total_mismatch_returns_no_fake_result(self):
        self.ozon_setup()
        self.response["result"]["totals"] = [99, 2500.25]
        with self.assertRaises(LabError) as caught:
            await self.orders()
        self.assertEqual(caught.exception.code, "OZON_TOTAL_MISMATCH")

    async def test_native_proof_drift_blocks_network(self):
        self.ozon_setup()
        self.native["qualifications"]["ozon_orders"]["scalar_hash"] = "unapproved"
        write(self.native_file, self.native)
        with self.assertRaises(LabError):
            await self.orders()
        self.assertEqual(self.calls, [])

    async def test_native_account_revocation_blocks_network(self):
        self.ozon_setup()
        self.native["accounts"]["synthetic-account"]["active"] = False
        write(self.native_file, self.native)
        with self.assertRaises(LabError) as caught:
            await self.orders()
        self.assertEqual(caught.exception.code, "STORE_SCOPE_DENIED")
        self.assertEqual(self.calls, [])

    async def test_native_unknown_currency_remains_unknown(self):
        self.ozon_setup()
        self.native["accounts"]["synthetic-account"]["stores"][0]["currency"] = None
        write(self.native_file, self.native)
        value = await self.orders()
        self.assertIsNone(value["data"]["currency"])
        self.assertTrue(value["data"]["warnings"])

    async def test_ozon_cooldown_prevents_automatic_second_query(self):
        self.ozon_setup()
        await self.orders()
        with self.assertRaises(LabError) as caught:
            await self.orders(date_to="2026-10-03")
        self.assertEqual(caught.exception.code, "LOCAL_RATE_LIMIT")
        self.assertGreaterEqual(caught.exception.retry_after, 61)
        self.assertEqual(len(self.calls), 1)

    async def test_native_stock_snapshot_separate_present_reserve_and_cache(self):
        self.stocks_setup()
        result = await self.app.call("marketplace_stock_snapshot", {})
        self.assertEqual(result["source"]["operation"], "ozon_stocks")
        self.assertEqual(result["source"]["url"], connectors.OZON_STOCKS_URL)
        self.assertEqual(result["data"]["product_count"], 1)
        self.assertEqual(result["data"]["fbo"], {"present_units": 7, "reserved_units": 2})
        self.assertEqual(result["data"]["fbs"], {"present_units": 11, "reserved_units": 3})
        self.assertNotIn("period", result["data"])
        self.assertEqual(json.loads(self.calls[0].content), {"filter": {}, "limit": 1000})
        again = await self.app.call("marketplace_stock_snapshot", {})
        self.assertEqual(again["execution"]["provider_requests_this_call"], 0)
        self.assertTrue(again["cache"]["hit"])
        self.assertEqual(len(self.calls), 1)

    async def test_native_stock_incomplete_page_never_reported_as_full(self):
        self.stocks_setup()
        self.response["total_items"] = 2
        self.response["cursor"] = "synthetic-next-page"
        with self.assertRaises(LabError) as caught:
            await self.app.call("marketplace_stock_snapshot", {})
        self.assertEqual(caught.exception.code, "INCOMPLETE_DATA")
        self.assertEqual(len(self.calls), 1)

    async def test_native_stock_duplicate_objects_rejected(self):
        self.stocks_setup()
        self.response["items"].append(deepcopy(self.response["items"][0]))
        self.response["total_items"] = 2
        with self.assertRaises(LabError):
            await self.app.call("marketplace_stock_snapshot", {})
        self.assertEqual(len(self.calls), 1)

    async def test_native_stock_required_real_qualification(self):
        self.stocks_setup()
        self.native["qualifications"].pop("ozon_stocks")
        write(self.native_file, self.native)
        with self.assertRaises(LabError):
            await self.app.call("marketplace_stock_snapshot", {})
        self.assertEqual(self.calls, [])

    async def test_native_stock_never_accepts_history_store_or_url_arguments(self):
        self.stocks_setup()
        for arguments in [{"date_from": "2026-10-01"}, {"store_id": "other"}, {"url": "http://127.0.0.1"}]:
            with self.assertRaises(LabError) as caught:
                await self.app.call("marketplace_stock_snapshot", arguments)
            self.assertEqual(caught.exception.code, "UNKNOWN_ARGUMENT")
        self.assertEqual(self.calls, [])

    async def test_completed_bounded_date_period(self):
        now = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)
        for start, end in [("2026-11-18", "2026-11-18"), ("2026-10-01", "2026-11-17"),
                           ("2026-11-17", "2026-11-16"), ("2026-13-01", "2026-13-02")]:
            with self.assertRaises(LabError):
                connectors.dates({"date_from": start, "date_to": end}, now)
        self.assertEqual(connectors.dates({"date_from": "2026-11-17", "date_to": "2026-11-17"}, now),
                         {"from": "2026-11-17", "to": "2026-11-17"})


class StdioProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_official_sdk_initialize_discovery_errors_no_mock_protocol(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.json"
            write(config, {"schema": "harness-lab-connectors/v1", "scope_id": "synthetic-owner", "revision": "v1",
                           "yandex": {"enabled": False}, "ozon": {"enabled": False}})
            parameters = StdioServerParameters(command=sys.executable, args=[str(ROOT / "server.py")],
                env={"HARNESS_LAB_CONNECTORS_FILE": str(config), "HARNESS_LAB_STATE_DIR": str(root / "state")})
            async with stdio_client(parameters) as streams:
                async with ClientSession(*streams) as client:
                    await client.initialize()
                    tools = (await client.list_tools()).tools
                    self.assertEqual({t.name for t in tools}, {"lab_capabilities", "yandex_collect_phrases", "marketplace_orders_report", "marketplace_stock_snapshot"})
                    self.assertTrue(all(t.inputSchema["additionalProperties"] is False for t in tools))
                    result = await client.call_tool("lab_capabilities", {})
                    self.assertEqual(result.structuredContent["kind"], "capabilities")
                    missing = await client.call_tool("yandex_collect_phrases", {"phrase": "synthetic"})
                    self.assertTrue(missing.isError)
                    self.assertEqual(missing.structuredContent["error"]["code"], "CONNECTOR_DISABLED")
                    orders = await client.call_tool("marketplace_orders_report", {"date_from": "2026-11-17", "date_to": "2026-11-17"})
                    self.assertEqual(orders.structuredContent["error"]["code"], "CONNECTOR_DISABLED")
                    secret = await client.call_tool("yandex_collect_phrases", {"phrase": "synthetic", "api_key": SECRET})
                    self.assertTrue(secret.isError)
                    self.assertEqual(secret.structuredContent["error"]["code"], "INVALID_ARGUMENTS")
                    self.assertNotIn(SECRET, secret.model_dump_json())


if __name__ == "__main__":
    unittest.main()
