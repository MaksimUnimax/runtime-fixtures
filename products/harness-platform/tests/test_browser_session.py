from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from tests.auth_fixture import email_opted_out

from platform_core.account_access import AccountAccess
from platform_core.browser_session import browser_routes, browser_token, require_browser_origin
from platform_core.identity import AuthenticationError
from platform_core.guest_registration import RegistrationStore


PASSWORD = "a browser account passphrase"


class BrowserSessionTests(TestCase):
    def setUp(self):
        directory = self.enterContext(TemporaryDirectory())
        self.identity = self.enterContext(RegistrationStore(Path(directory) / "accounts.sqlite3"))
        self.identity.create_account("account", PASSWORD)
        self.app = Starlette(routes=browser_routes() + [Route("/protected", self.protected, methods=["GET", "POST"])])
        self.app.state.identity = self.identity
        self.app.state.account_access = AccountAccess(self.identity)
        email_opted_out(self.identity, "account")

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
        anonymous = client.get("/api/session/status")
        self.assertEqual(anonymous.json(), {"authenticated": False})
        self.assertEqual(anonymous.headers["cache-control"], "no-store")
        self.assertNotIn("set-cookie", anonymous.headers)
        page = client.get("/login")
        self.assertEqual(page.status_code, 200)
        self.assertIn('data-panel="login"', page.text)
        self.assertEqual(page.headers["cache-control"], "no-store")
        response = client.post("/login", data={"login": "account", "password": PASSWORD}, headers={"Origin": origin})
        self.assertEqual((response.status_code, response.headers["location"]), (303, "/app/"))
        cookie = response.headers["set-cookie"].lower()
        for flag in ["__host-harness_session=", "httponly", "samesite=strict", "secure", "path=/"]:
            self.assertIn(flag, cookie)
        self.assertNotIn("domain=", cookie)
        token = client.cookies.get("__Host-harness_session")
        self.assertTrue(token)
        self.assertEqual(client.get("/api/session/status").json(), {"authenticated": True})
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
        client.cookies.set("__Host-harness_session", token)
        self.assertEqual(client.get("/api/session/status").json(), {"authenticated": False})
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
        self.assertIn("Не удалось войти", failed.text)
        self.assertNotIn("an incorrect passphrase", failed.text)
        ok = client.post("/login", data=fields, headers=headers)
        self.assertEqual(ok.status_code, 303)
        self.assertIn("harness_local_session=", ok.headers["set-cookie"])
        self.assertNotIn("secure", ok.headers["set-cookie"].lower())
        with TestClient(self.app, base_url="http://external.example") as remote:
            self.assertEqual(remote.get("/login").status_code, 403)

    def test_password_change_checks_origin_and_replaces_sessions(self):
        origin = "https://harness.example"
        client = self.enterContext(TestClient(self.app, base_url=origin, follow_redirects=False))
        headers = {"Origin": origin}
        self.assertEqual(client.post("/login", data={"login": "account", "password": PASSWORD},
                                     headers=headers).status_code, 303)
        current = client.cookies.get("__Host-harness_session")
        other = self.identity.login("account", PASSWORD)
        self.identity.create_account("another", PASSWORD)
        unaffected = self.identity.login("another", PASSWORD)
        path = "/api/profile/password"
        new = "Пароль с пробелом и знаком +"
        fields = {"current": PASSWORD, "password": new, "confirmation": new}
        self.assertEqual(client.get(path).status_code, 405)
        self.assertEqual(client.post(path, data=fields).status_code, 403)
        self.assertEqual(client.post(path, data=dict(fields, confirmation="wrong"), headers=headers).status_code, 400)
        self.assertEqual(client.post(path, data=dict(fields, current="wrong"), headers=headers).status_code, 400)
        self.identity.validate_session(other)
        self.assertEqual(client.cookies.get("__Host-harness_session"), current)
        response = client.post(path, data=fields, headers=headers)
        self.assertEqual(response.json(), {"changed": True})
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        renewed = client.cookies.get("__Host-harness_session")
        self.assertNotEqual(current, renewed)
        self.identity.validate_session(renewed)
        self.identity.validate_session(unaffected)
        for obsolete in (current, other):
            with self.assertRaises(AuthenticationError):
                self.identity.validate_session(obsolete)
        with self.assertRaises(AuthenticationError):
            self.identity.login("account", PASSWORD)
        self.identity.validate_session(self.identity.login("account", new))

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
