"""Owner approvals by audit section, not by the audit's final priority table."""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[3] / 'apps/site/public'
FIXTURE = json.loads((Path(__file__).parent / 'fixtures/approved_r5_baseline.json').read_text())

class VisibleText(HTMLParser):
    def __init__(self, html):
        super().__init__(); self.skip = 0; self.parts = []; self.feed(html)
    def handle_starttag(self, tag, attrs):
        if tag in ('head', 'script', 'style'): self.skip += 1
        if tag == 'br' and not self.skip: self.parts.append(' ')
    def handle_endtag(self, tag):
        if tag in ('head', 'script', 'style'): self.skip -= 1
        if tag in ('p','h1','h2','h3','h4','li','div','section','article') and not self.skip: self.parts.append(' ')
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)
    def text(self):
        return ' '.join(''.join(self.parts).split())

def visible(html):
    return VisibleText(html).text()

class ApprovedCopyTests(unittest.TestCase):
    def setUp(self):
        self.home = (ROOT / 'index.html').read_text()
    def test_native_groups_retain_all_twelve_capabilities(self):
        groups = re.findall(r'<details class="capability-group"([^>]*)>(.*?)</details>', self.home, re.S)
        self.assertEqual(len(groups), 6)
        cards = []
        for attrs, body in groups:
            self.assertNotRegex(attrs, r'\b(?:open|name)\s*(?:=|$)')
            self.assertTrue(body.startswith('<summary>'))
            self.assertEqual(body.count('<summary>'), 1)
            children = re.findall(r'<article>.*?</article>', body, re.S)
            self.assertEqual(len(children), 2)
            cards.extend(visible(c) for c in children)
        self.assertCountEqual(cards, FIXTURE['cards'])
        self.assertNotRegex(self.home, r'<script(?![^>]*application/ld\+json)')
    def test_approved_owner_copy_and_api_tokens_remain(self):
        for paragraph in FIXTURE['home_owner_paragraphs']:
            self.assertIn(paragraph, visible(self.home))
        self.assertIn('Сильную модель нейросети Октопорт превращает в полноценного сотрудника.', self.home)
        for name in ('index.html', 'support.html'):
            self.assertIn('API-токены', (ROOT / name).read_text())
        for name, terms in {'index.html':['топ товаров','бизнес-состояние','сырые отчёты'], 'privacy.html':['ревизии реквизитов','операционные и административные метаданные','финансовых переходов','сырые отчёты'], 'support.html':['полные экспорты','сырые отчёты','бете']}.items():
            for term in terms: self.assertIn(term, (ROOT / name).read_text(), (name, term))
    def test_install_instructions_unchanged_byte_for_byte(self):
        html = (ROOT / 'install.html').read_text()
        main = re.search(r'<main\b.*?</main>', html, re.S).group()
        self.assertEqual(hashlib.sha256(main.encode()).hexdigest(), FIXTURE['install_main_sha256'])
    def test_full_home_heading(self):
        headings = re.findall(r'<h1\b[^>]*>.*?</h1>', self.home, re.S)
        self.assertEqual(len(headings), 1)
        self.assertEqual(visible(headings[0]), 'Личный помощник на базе любимой Нейросети.')
    def test_unapproved_english_is_absent_outside_instructions(self):
        forbidden = re.compile(r'\bread-only\b|\bseller-owned\b|\bBackend\b|\bPrivacy\b|\bSupport\b|\bAI[- ]|\bDOM-|\brequest ID\b|\bclient secrets\b|\bOTP\b|\bcookies\b|\bSeller Client ID\b|\bAPI key\b|\bPerformance credentials\b|\bPersonal token\b|\bCTR\b|\bCPC\b|\bOctoport\b')
        for name in ('index.html','seller-analytics.html','privacy.html','support.html'):
            self.assertEqual(forbidden.findall(visible((ROOT / name).read_text())), [], name)
    def test_russian_site_name_keeps_latin_search_alias(self):
        data = json.loads(re.search(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', self.home, re.S).group(1))
        self.assertEqual(data['name'], 'Октопорт')
        self.assertEqual(data['alternateName'], ['Octoport', 'octoport.ru'])
    def test_analytics_has_concrete_examples_and_real_result_boundaries(self):
        html = (ROOT / 'seller-analytics.html').read_text()
        self.assertEqual(html.count('class="analytics-case verified-example"'), 2)
        for term in ('сентябре 2026 года','остаток неизвестен','не означает, что товар закончился','Суммы, названия товаров и идентификаторы продавца не публикуются','выручка','количество заказанных единиц'):
            self.assertIn(term, html)
        self.assertNotIn('Публичные демонстрации, конкретные категории данных', html)
        for target in ('/#how', 'mailto:support@octoport.ru?subject=Бета%20Октопорт'):
            self.assertIn('href="' + target + '"', html)
    def test_support_prioritises_contact_before_limits(self):
        html = (ROOT / 'support.html').read_text()
        self.assertLess(html.index('Написать в поддержку'), html.index('id="beta-status"'))
        for term in ('id="beta-access"', 'id="report-problem"', 'API-токены', 'идентификатор запроса'):
            self.assertIn(term, html)
    def test_new_styles_include_keyboard_focus_and_scoped_layout(self):
        css = (ROOT / 'styles.css').read_text()
        for term in ('.capability-group > summary:focus-visible', '.capability-group[open]', '.hero-heading .hero-choice', '.analysis-flow'):
            self.assertIn(term, css)

if __name__ == '__main__':
    unittest.main()
