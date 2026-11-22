import io
import json
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from starlette.testclient import TestClient

from platform_core.chat_api import create_app


class AdminVisits(unittest.TestCase):
    path = "/admin/visits"
    token = "demo_metrika_token_001"

    def test_check_save_and_report_require_admin_and_keep_token_private(self):
        directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        app = create_app(directory / "identity.sqlite3", directory / "chat")
        client = self.enterContext(TestClient(app, base_url="https://example.test"))
        identity = app.state.identity
        password = "Only used within the test fixture"
        identity.create_account("administrator", password)
        identity.create_account("seller", password)
        identity.set_admin("administrator", True)
        owner = identity.login("administrator", password)
        user = identity.login("seller", password)
        self.assertEqual(client.get(self.path).status_code, 401)
        client.cookies.set("__Host-harness_session", user, path="/")
        self.assertEqual(client.get(self.path).status_code, 403)
        self.assertEqual(client.post(self.path, data={"token": self.token},
                                     headers={"Origin": "https://example.test"}).status_code, 403)
        client.cookies.set("__Host-harness_session", owner, path="/")
        initial = client.get(self.path)
        self.assertEqual(initial.status_code, 200)
        self.assertIn('type="password" name="token"', initial.text)
        self.assertIn('metrika:read', initial.text)
        self.assertIn('/admin/visits', client.get('/admin').text)
        self.assertIn('/admin/visits', client.get('/admin/statistics').text)
        self.assertNotIn('yandex-metrika.js', initial.text)
        self.assertNotIn('mc.yandex', initial.headers["Content-Security-Policy"])
        self.assertEqual(initial.headers["Cache-Control"], "no-store")
        self.assertEqual(client.post(self.path, data={"token": self.token},
                                     headers={"Origin": "https://foreign.test"}).status_code, 403)
        self.assertFalse(app.state.metrika_token_path.exists())

        requests = []

        def metrika_response(request, *, timeout):
            requests.append(request)
            if request.get_header("Authorization") != "OAuth " + self.token:
                raise HTTPError(request.full_url, 403, "access denied", {}, io.BytesIO())
            parsed = urlsplit(request.full_url)
            params = parse_qs(parsed.query)
            self.assertEqual(parsed.hostname, "api-metrika.yandex.net")
            self.assertEqual(params["ids"], ["114504756"])
            totals = [24, 16, 31, 2.5, 63.7]
            data = [{"dimensions": [{"name": "<Запрос>"}], "metrics": totals}] if "dimensions" in params else []
            return io.BytesIO(json.dumps({"totals": totals, "data": data}).encode())

        origin = {"Origin": "https://example.test"}
        opener = Mock()
        opener.open.side_effect = metrika_response
        with patch("platform_core.admin_visits.build_opener", return_value=opener):
            rejected = client.post(self.path, data={"token": "unsupported_token"}, headers=origin)
            self.assertEqual(rejected.status_code, 400)
            self.assertNotIn("unsupported_token", rejected.text)
            self.assertFalse(app.state.metrika_token_path.exists())

            saved = client.post(self.path, data={"token": self.token}, headers=origin)
            self.assertEqual(saved.status_code, 200)
            self.assertIn("Доступ к Метрике проверен.", saved.text)
            self.assertIn("<dd>24</dd>", saved.text)
            self.assertIn("&lt;Запрос&gt;", saved.text)
            self.assertIn("Источники трафика", saved.text)
            self.assertNotIn(self.token, saved.text)
            self.assertEqual(stat.S_IMODE(app.state.metrika_token_path.stat().st_mode), 0o600)
            self.assertEqual(app.state.metrika_token_path.read_text().strip(), self.token)
            self.assertEqual(list(directory.glob(".metrika-*")), [])

            replacement = client.post(self.path, data={"token": "invalid_replacement"}, headers=origin)
            self.assertEqual(replacement.status_code, 400)
            self.assertEqual(app.state.metrika_token_path.read_text().strip(), self.token)
            self.assertIn('<option value="30" selected>', client.get(self.path + "?period=30").text)
        dimensions = [parse_qs(urlsplit(req.full_url).query).get("dimensions") for req in requests]
        self.assertIn(["ym:s:date"], dimensions)
        self.assertIn(["ym:s:lastTrafficSource"], dimensions)
        self.assertIn(["ym:s:startURLPathLevel1Hash"], dimensions)
