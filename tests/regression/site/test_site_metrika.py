"""Source-level contract for the owner-provided Yandex Metrika counter."""
from html.parser import HTMLParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3] / "apps/site/public"
PAGES = (
    "index.html",
    "seller-analytics.html",
    "privacy.html",
    "support.html",
    "install.html",
)
SCRIPT_TAG = '<script src="/assets/yandex-metrika.js" defer></script>'
PIXEL_SRC = "https://mc.yandex.ru/watch/113424299"


class PageContract(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_body = False
        self.noscript_depth = 0
        self.scripts = []
        self.noscript_images = []
        self.robots = []

    def handle_starttag(self, tag, pairs):
        attrs = dict(pairs)
        if tag == "body":
            self.in_body = True
        elif tag == "noscript" and self.in_body:
            self.noscript_depth += 1
        elif tag == "img" and self.in_body and self.noscript_depth:
            self.noscript_images.append(attrs)
        elif tag == "script":
            self.scripts.append(attrs)
        elif tag == "meta" and attrs.get("name") == "robots":
            self.robots.append(attrs.get("content"))

    def handle_endtag(self, tag):
        if tag == "noscript" and self.noscript_depth:
            self.noscript_depth -= 1
        elif tag == "body":
            self.in_body = False


class YandexMetrikaSourceTests(unittest.TestCase):
    def test_every_public_html_page_has_one_shared_loader_and_body_pixel(self):
        self.assertEqual(tuple(sorted(path.name for path in ROOT.glob("*.html"))), tuple(sorted(PAGES)))
        for name in PAGES:
            with self.subTest(page=name):
                html = (ROOT / name).read_text(encoding="utf-8")
                parser = PageContract()
                parser.feed(html)

                runtime_scripts = [
                    attrs for attrs in parser.scripts
                    if attrs.get("type") != "application/ld+json"
                ]
                self.assertEqual(runtime_scripts, [{"src": "/assets/yandex-metrika.js", "defer": None}])
                self.assertEqual(html.count(SCRIPT_TAG), 1)
                self.assertEqual(len(parser.noscript_images), 1)
                self.assertEqual(parser.noscript_images[0].get("src"), PIXEL_SRC)
                self.assertEqual(parser.noscript_images[0].get("alt"), "")
                style = parser.noscript_images[0].get("style", "").replace(" ", "")
                self.assertIn("position:absolute", style)
                self.assertIn("left:-9999px", style)

        install = PageContract()
        install.feed((ROOT / "install.html").read_text(encoding="utf-8"))
        self.assertEqual(install.robots, ["noindex, follow"])

    def test_loader_matches_requested_settings_and_has_duplicate_guards(self):
        loader = (ROOT / "assets/yandex-metrika.js").read_text(encoding="utf-8")
        for expected in (
            "https://mc.yandex.ru/metrika/tag.js?id=",
            "var initializedFlag = \"__octoportMetrika\" + counterId + \"Initialized\";",
            "window[initializedFlag]",
            "scripts[index].src === counterScriptUrl",
            "window.dataLayer = window.dataLayer || [];",
            "window.ym(counterId, \"init\", {",
            "ssr: true",
            "clickmap: true",
            'ecommerce: "dataLayer"',
            "referrer: document.referrer",
            "url: location.href",
            "accurateTrackBounce: true",
            "trackLinks: true",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, loader)
        for forbidden in ("webvisor:", "reachGoal", '"hit"', "dataLayer.push"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, loader)

    def test_privacy_page_discloses_counter_and_collected_site_signals(self):
        privacy = (ROOT / "privacy.html").read_text(encoding="utf-8")
        for expected in (
            'id="site-analytics"',
            "Яндекс.Метрика",
            "113424299",
            "адрес текущей страницы",
            "источник перехода",
            "кликах и переходах по ссылкам",
            "файлы cookie",
            "Сайт не отправляет события электронной торговли или специальные цели.",
            "Вебвизор и аналитика форм не включены.",
            "https://yandex.ru/legal/confidential/",
        ):
            with self.subTest(expected=expected):
                self.assertIn(expected, privacy)


if __name__ == "__main__":
    unittest.main()
