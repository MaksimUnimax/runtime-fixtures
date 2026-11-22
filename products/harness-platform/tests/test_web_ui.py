"""Product routes enforce the same account boundary for HTML and browser JSON."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.identity import IdentityStore


class WebUiTests(unittest.TestCase):
    def test_cookie_routes_share_membership_and_session_revocation(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "platform.sqlite3"
            password = "Local test password for the browser"
            with IdentityStore(database) as identity:
                identity.create_account("seller", password)
                identity.create_account("other", password)
                foreign = identity.create_user_chat(identity.login("other", password)).chat_id
            app = create_app(database, Path(directory) / "chats")
            origin = "https://platform.test"
            with TestClient(app, base_url=origin, follow_redirects=False) as browser:
                self.assertIn('data-mode="guest"', browser.get("/app/").text)
                self.assertEqual(browser.get("/admin").status_code, 401)
                self.assertEqual(browser.get("/api/chats").status_code, 401)
                auth = browser.post("/login", data={"login": "seller", "password": password},
                                    headers={"Origin": origin})
                self.assertEqual(auth.headers["location"], "/app/")
                self.assertEqual(browser.post("/api/chats").status_code, 403)
                self.assertEqual(browser.get("/admin").status_code, 403)
                chat = browser.post("/api/chats", headers={"Origin": origin}).json()["chatId"]
                page = browser.get(f"/app/chats/{chat}")
                self.assertEqual(page.status_code, 200)
                self.assertIn("no-store", page.headers["cache-control"])
                self.assertEqual(browser.get(f"/app/chats/{foreign}").status_code, 404)
                self.assertEqual(browser.get(f"/api/chats/{foreign}/events").status_code, 404)
                self.assertEqual(browser.get("/api/chats").json(), [chat])
                self.assertEqual(browser.get("/api/chats", headers={"Authorization": "Bearer invalid"}).status_code, 401)
                browser.post("/logout", headers={"Origin": origin})
                self.assertEqual(browser.get(f"/app/chats/{chat}").status_code, 404)

    def test_payment_quote_tracks_configured_price_and_keeps_wallet_private(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "platform.sqlite3"
            with IdentityStore(db) as store:
                store.create_account("owner", "test owner password")
                store.set_admin("owner", True)
                token = store.login("owner", "test owner password")
                store.pricing(token, "12.34", update=True)
                store.create_account("buyer", "test buyer password")
                buyer = store.login("buyer", "test buyer password")
            app = create_app(db, Path(directory) / "chats")
            with TestClient(app, base_url="https://platform.test") as client:
                self.assertEqual(client.get("/api/wallet/balance").status_code, 401)
                legacy = client.get("/payment?coins=3", follow_redirects=False)
                self.assertEqual(legacy.headers["location"], "/about/?coins=3#buy-coins")
                quote = client.get("/api/coins/quote?coins=3")
                self.assertEqual(quote.status_code, 200)
                self.assertEqual(quote.json()["total"], "3.37")
                self.assertEqual(set(quote.json()), {"total","enabled"})
                self.assertEqual(client.get("/api/coins/quote?coins=-1").status_code, 400)
                auth = {"Authorization":"Bearer " + buyer}
                self.assertEqual(client.get("/api/wallet/balance", headers=auth).json(), {"available":"10"})
                with IdentityStore(db) as store:
                    store.pricing(token, "30", update=True)
                self.assertEqual(client.get("/api/coins/quote?coins=3").json()["total"], "3.90")

    def test_ui_assets_only_serve_browser_distribution(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"HARNESS_NODE_MODULES": directory}):
            dist = Path(directory) / "@deepseek-ai" / "dsh-client-ui-chat" / "lib"
            dist.mkdir(parents=True)
            (dist / "client.js").write_text("// fixture")
            app = create_app(Path(directory) / "platform.sqlite3", Path(directory) / "chats")
            with TestClient(app) as client:
                css = client.get("/ui-assets/project/account.css", headers={"Accept-Encoding":"gzip"})
                self.assertEqual(css.headers["content-encoding"],"gzip")
                self.assertIn("public",css.headers["cache-control"])
                self.assertEqual(client.get("/ui-assets/project/account.css", headers={"If-None-Match":css.headers["etag"]}).status_code,304)
                root = "/ui-assets/harness/dsh-client-ui-chat/"
                self.assertEqual(client.get(root + "lib/client.js").text, "// fixture")
                self.assertEqual(client.get(root + "lib/index.js").status_code, 404)
                build = Path(directory) / "@deepseek-ai" / "dsh-web-frontend" / "dist" / "assets"
                build.mkdir(parents=True)
                (build / "index-BgUyXZcc.js").write_text("// unknown release")
                self.assertEqual(client.get(
                    "/ui-assets/harness/dsh-web-frontend/dist/assets/index-BgUyXZcc.js"
                ).status_code, 503)
                self.assertEqual(client.get("/ui-assets/project/index.html").status_code, 404)
