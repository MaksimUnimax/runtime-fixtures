from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from platform_core.browser_session import browser_routes, browser_token, require_browser_origin
from platform_core.identity import AuthenticationError, IdentityStore


PASSWORD = "a browser account passphrase"


class BrowserSessionTests(TestCase):
    def setUp(self):
        directory = self.enterContext(TemporaryDirectory())
        self.identity = self.enterContext(IdentityStore(Path(directory) / "accounts.sqlite3"))
        self.identity.create_account("account", PASSWORD)
        self.app = Starlette(routes=browser_routes() + [Route("/protected", self.protected, methods=["GET", "POST"])])
        self.app.state.identity = self.identity

    async def protected(self, req):
        try:
            token = browser_token(req)
            self.identity.validate_session(token)
        except AuthenticationError:
            return JSONResponse({}, status_code=401)
        return JSONResponse({"ok": True})

    def test_https_cookie_round_trip_and_real_logout(self):
        origin = "https://harness.example"
        client = self.enterContext(TestClient(self.app, base_url=origin, follow_redirects=False))
        page = client.get("/login")
        self.assertEqual(page.status_code, 200)
        self.assertIn('autocomplete="current-password"', page.text)
        self.assertEqual(page.headers["cache-control"], "no-store")
        response = client.post("/login", data={"login": "account", "password": PASSWORD}, headers={"Origin": origin})
        self.assertEqual((response.status_code, response.headers["location"]), (303, "/app/"))
        cookie = response.headers["set-cookie"].lower()
        for flag in ["__host-harness_session=", "httponly", "samesite=strict", "secure", "path=/"]:
            self.assertIn(flag, cookie)
        self.assertNotIn("domain=", cookie)
        token = client.cookies.get("__Host-harness_session")
        self.assertTrue(token)
        self.assertNotIn(token, response.text)
        self.assertEqual(client.get("/login").headers["location"], "/app/")
        self.assertEqual(client.get("/protected").status_code, 200)
        self.assertEqual(client.post("/protected").status_code, 403)
        self.assertEqual(client.post("/protected", headers={"Origin": origin}).status_code, 200)
        self.assertEqual(client.get("/logout").status_code, 405)
        self.assertEqual(client.post("/logout", headers={"Origin": "https://elsewhere.example"}).status_code, 403)
        self.identity.validate_session(token)
        logged_out = client.post("/logout", headers={"Origin": origin})
        self.assertEqual((logged_out.status_code, logged_out.headers["location"]), (303, "/login"))
        self.assertIn("max-age=0", logged_out.headers["set-cookie"].lower())
        self.assertEqual(client.get("/protected").status_code, 401)
        with self.assertRaises(AuthenticationError):
            self.identity.validate_session(token)

    def test_origin_transport_and_credentials_validation(self):
        origin = "http://127.0.0.1:16756"
        client = self.enterContext(TestClient(self.app, base_url=origin, follow_redirects=False))
        fields = {"login": "account", "password": PASSWORD}
        for other in [None, "null", "http://127.0.0.1:16757", "https://127.0.0.1:16756"]:
            headers = {} if other is None else {"Origin": other}
            self.assertEqual(client.post("/login", data=fields, headers=headers).status_code, 403)
        headers = {"Origin": origin}
        self.assertEqual(client.post("/login", json=fields, headers=headers).status_code, 415)
        failed = client.post("/login", data=dict(fields, password="an incorrect passphrase"), headers=headers)
        self.assertEqual(failed.status_code, 401)
        self.assertIn('role="alert"', failed.text)
        self.assertNotIn("an incorrect passphrase", failed.text)
        ok = client.post("/login", data=fields, headers=headers)
        self.assertEqual(ok.status_code, 303)
        self.assertIn("harness_local_session=", ok.headers["set-cookie"])
        self.assertNotIn("secure", ok.headers["set-cookie"].lower())
        with TestClient(self.app, base_url="http://external.example") as remote:
            self.assertEqual(remote.get("/login").status_code, 403)

    def test_switch_replaces_the_browser_session(self):
        origin = "https://harness.example"
        client = self.enterContext(TestClient(self.app, base_url=origin, follow_redirects=False))
        def sign_in():
            response = client.post("/login", data={"login": "account", "password": PASSWORD}, headers={"Origin": origin})
            self.assertEqual(response.status_code, 303)
            return client.cookies.get("__Host-harness_session")

        old, current = sign_in(), sign_in()
        self.assertNotEqual(old, current)
        self.identity.validate_session(current)
        with self.assertRaises(AuthenticationError):
            self.identity.validate_session(old)

    def test_websocket_uses_the_matching_http_origin(self):
        def request(origin):
            return HTTPConnection({"type": "websocket", "scheme": "wss", "path": "/socket",
                                   "query_string": b"", "headers": [(b"host", b"harness.example:443"),
                                   (b"origin", origin), (b"cookie", b"__Host-harness_session=t")]})
        self.assertEqual(browser_token(request(b"https://harness.example")), "t")
        with self.assertRaises(HTTPException) as exc:
            require_browser_origin(request(b"https://other.example"))
        self.assertEqual(exc.exception.status_code, 403)
