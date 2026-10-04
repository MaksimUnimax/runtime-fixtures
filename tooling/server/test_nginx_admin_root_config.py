from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "infra/production/nginx/octoport-apps.conf"

REQUIRED_FORWARDING = (
    "proxy_http_version 1.1;",
    "proxy_set_header Host $host;",
    "proxy_set_header X-Real-IP $remote_addr;",
    "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "proxy_set_header X-Forwarded-Proto $scheme;",
)


def location_block(text: str, header: str) -> str:
    marker = f"    {header} {{"
    start = text.find(marker)
    if start < 0:
        raise AssertionError(f"missing nginx block: {header}")
    line_end = text.find("\n", start)
    depth = 1
    pos = line_end + 1
    while pos < len(text):
        next_end = text.find("\n", pos)
        if next_end < 0:
            next_end = len(text)
        line = text[pos:next_end]
        depth += line.count("{") - line.count("}")
        if depth == 0:
            return text[start:next_end + (1 if next_end < len(text) else 0)]
        pos = next_end + 1
    raise AssertionError(f"unterminated nginx block: {header}")


class NginxAdminRootConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = CONFIG.read_text(encoding="utf-8")

    def test_exact_admin_root_proxies_to_admin_app_without_redirect(self):
        block = location_block(self.text, "location = /admin")
        self.assertIn("proxy_pass http://127.0.0.1:3101;", block)
        self.assertNotIn("return 308", block)
        for directive in REQUIRED_FORWARDING:
            self.assertIn(directive, block)

    def test_admin_subpath_keeps_same_admin_upstream_and_forwarding_headers(self):
        block = location_block(self.text, "location ^~ /admin/")
        self.assertIn("proxy_pass http://127.0.0.1:3101;", block)
        for directive in REQUIRED_FORWARDING:
            self.assertIn(directive, block)

    def test_admin_root_and_subpath_are_each_declared_once(self):
        self.assertEqual(self.text.count("location = /admin {"), 1)
        self.assertEqual(self.text.count("location ^~ /admin/ {"), 1)


if __name__ == "__main__":
    unittest.main()
