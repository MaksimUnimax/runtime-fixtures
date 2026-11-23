from collections import Counter
import unittest

from platform_core.marketplace_matrix import action_templates, read_templates


class MarketplaceActionTemplatesTest(unittest.TestCase):
    def test_catalogue_keeps_historical_versions_out_of_active_list(self):
        active = action_templates.catalogue()
        full = action_templates.catalogue(include_reference=True)
        self.assertEqual(Counter(row["profile"] for row in active),
                         {"seller": 175, "performance": 15, "wb": 106})
        self.assertEqual(Counter(row["lifecycle"] for row in full),
                         {"current": 296, "deprecated": 4, "retired": 7})
        for row in full:
            with self.subTest(template=row["id"]):
                self.assertTrue(row["hosts"])
                self.assertTrue(row["source"]["url"].startswith("https://"))
                self.assertTrue(row["success"])

    def test_catalogue_finds_get_writes_and_shared_paths(self):
        get_writes = action_templates.catalogue(method="GET")
        self.assertEqual(Counter(row["profile"] for row in get_writes), {"performance": 3, "wb": 4})
        rows = action_templates.catalogue(profile="wb", query="/api/v3/stocks/{warehouseId}")
        self.assertEqual({row["http"] for row in rows}, {"PUT", "DELETE"})
        rows = action_templates.catalogue(profile="performance", query="параметры рекламной")
        self.assertEqual([row["http"] for row in rows], ["PATCH"])
        self.assertEqual(len(action_templates.catalogue(profile="seller", query="/v1/review/first-reviews-collection/")), 6)

    def test_action_paths_have_no_ready_read_template(self):
        def route(row):
            return row["profile"], row["http"], row["path"]

        writes = {route(row) for row in action_templates.catalogue(include_reference=True)}
        reads = {route(row) for row in read_templates.cards().values() if row["state"] == "ready"}
        self.assertFalse(writes & reads)
        self.assertTrue(action_templates.cards().keys().isdisjoint(read_templates.cards()))
        barcodes = action_templates.cards()["action.wb.post_content_v2_barcodes"]
        self.assertEqual(barcodes["effect"], "generate_identifiers")
        self.assertEqual(read_templates.cards()["read.wb.content_barcodes"]["state"], "effect")

    def test_action_form_includes_path_parameters_and_provider_updates(self):
        stock = action_templates.cards()["action.wb.put_api_v3_stocks_warehouseid"]
        self.assertEqual(stock["hosts"], ["marketplace-api.wildberries.ru"])
        self.assertEqual(stock["sandboxHosts"], ["marketplace-api-sandbox.wildberries.ru"])
        self.assertIn({"name": "warehouseId", "in": "path", "required": True}, [
            {key: param[key] for key in ("name", "in", "required")} for param in stock["input"]["parameters"]
        ])
        order = action_templates.cards()["action.seller.post_v2_order_create"]
        buyer = order["input"]["body"]["content"]["application/json"]["properties"]["buyer"]
        self.assertIn("email", buyer["required"])
