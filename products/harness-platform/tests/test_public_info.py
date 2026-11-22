"""The public documents link to the current product and retain old inbound URLs."""
from html.parser import HTMLParser
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.parse import urlsplit

from deploy.publish_info import PAGES, publish, route


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.anchors = set()
        self.urls = []
        self.h1 = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.anchors.add(attrs["id"])
        if tag == "h1":
            self.h1 += 1
        for attr in ("href", "src"):
            if attr in attrs:
                self.urls.append(urlsplit(attrs[attr]))


class PublicInfoTests(unittest.TestCase):
    def test_published_navigation_and_documents(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            (source / "assets").mkdir(parents=True)
            for name in ("favicon.ico", "favicon.png", "assets/octoport-brand.png", "assets/favicon-contour-v1.png"):
                (source / name).write_bytes(b"image fixture")
            publish(source, root / "releases")
            public = root / "releases/current"
            pages = {}
            for name in PAGES:
                html = (public / "about" / (name + ".html")).read_text()
                parsed = Links()
                parsed.feed(html)
                self.assertEqual(parsed.h1, 1)
                self.assertEqual("741705866660" in html, name == "index")
                self.assertEqual("320745600093211" in html, name == "index")
                if name == "index":
                    self.assertIn("741705866660", html.partition("<footer>")[2])
                    self.assertIn('data-buy-coins', html)
                    self.assertIn('Попробовать бесплатно', html)
                self.assertNotRegex(html.lower(), "расширени|каталог дополнений|личн[а-я]* кабинет|войти в кабинет|открыть кабинет")
                pages[route(name)] = parsed
            for address, parsed in pages.items():
                for url in parsed.urls:
                    if url.scheme or url.netloc:
                        continue
                    target = url.path or address
                    if target in pages:
                        if url.fragment:
                            self.assertIn(url.fragment, pages[target].anchors)
                    elif target == "/about/ask":
                        continue  # This route is served by the chat application.
                    elif target.startswith("/about/"):
                        self.assertTrue((public / target.lstrip("/")).is_file(), target)
                    else:
                        self.assertIn(target, ("/", "/register", "/login", "/admin", "/ui-assets/project/theme.js", "/ui-assets/project/checkout.css", "/ui-assets/project/checkout.js"))
