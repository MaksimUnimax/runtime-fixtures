"""Build the public Octoport pages and atomically publish them under /about/."""
import argparse
from hashlib import sha256
from html import escape
import os
from pathlib import Path
import shutil
from string import Template
import tempfile

PAGES = {
    "index": ("О сервисе", "Личный помощник для продавца", "Продажи, реклама, остатки и финансы Ozon и Wildberries в одном чате Октопорта."),
    "seller-analytics": ("Аналитика", "Аналитика вашего магазина", "Примеры разбора продаж, позиций в поиске и маржинальности товара."),
    "install": ("Подключение магазина", "Подключение магазина", "Как подключить Seller API и Performance API Ozon или токен Wildberries через «Настройки» → «Интеграции»."),
    "support": ("Поддержка", "Поддержка Октопорта", "Помощь со входом, подключением магазина и вопросами о работе помощника."),
    "privacy": ("Конфиденциальность", "Конфиденциальность и данные", "Как Октопорт обрабатывает ключи, результаты запросов и историю чатов."),
}
CONTENT = Path(__file__).resolve().parents[1] / "public-info"

def route(name):
    return "/about/" + ("" if name == "index" else name)

def publish(source, destination):
    destination.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="info-", dir=destination)).resolve()
    try:
        stage.chmod(0o755)
        info = stage / "about"
        assets = info / "assets"
        assets.mkdir(parents=True)
        for filename in ("favicon.ico", "favicon.png"):
            shutil.copyfile(source / filename, info / filename)
        for filename in ("octoport-brand.png", "favicon-contour-v1.png"):
            shutil.copyfile(source / "assets" / filename, assets / filename)
        shutil.copyfile(CONTENT / "yandex-metrika.js", assets / "yandex-metrika.js")
        session_script = assets / "public-session.js"
        shutil.copyfile(CONTENT / session_script.name, session_script)
        session_version = sha256(session_script.read_bytes()).hexdigest()[:12]
        design = CONTENT.parent / "native" / "web"
        shutil.copyfile(design / "octoport-wordmark.svg", assets / "octoport-wordmark.svg")
        (info / "styles.css").write_bytes((design / "appearance.css").read_bytes() + b"\n" +
                                         (CONTENT / "styles.css").read_bytes())
        version = sha256((info / "styles.css").read_bytes()).hexdigest()[:12]
        template = Template((CONTENT / "layout.html").read_text())
        for name, (label, title, description) in PAGES.items():
            links = []
            for target, (caption, _, _) in PAGES.items():
                current = ' aria-current="page"' if target == name else ""
                links.append(f'<a href="{route(target)}"{current}>{escape(caption)}</a>')
            html = template.substitute(label=label, title=title, description=description, version=version,
                                       session_version=session_version,
                                       seller=(CONTENT / "seller-footer.html").read_text() if name == "index" else "",
                                       navigation="\n".join(links), content=(CONTENT / f"{name}.html").read_text(),
                                       canonical="https://octoport.ru" + route(name))
            (info / f"{name}.html").write_text(html)
        urls = "".join(f"<url><loc>https://octoport.ru{route(name)}</loc></url>\n" for name in PAGES)
        (info / "sitemap.xml").write_text('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '</urlset>\n')
        (info / "robots.txt").write_text("User-agent: *\nAllow: /about/\nSitemap: https://octoport.ru/about/sitemap.xml\n")
        pointer = stage / "next"
        pointer.symlink_to(stage)
        os.replace(pointer, destination / "current")
    except BaseException:
        shutil.rmtree(stage)
        raise

if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("source", type=Path, help="Existing Octoport site with the approved image assets")
    cli.add_argument("destination", type=Path)
    args = cli.parse_args()
    publish(args.source, args.destination)
