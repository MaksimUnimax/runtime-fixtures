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
    def test_analytics_removes_superseded_verified_examples_block(self):
        html = (ROOT / 'seller-analytics.html').read_text()
        self.assertNotIn('id="analytics-proof"', html)
        self.assertNotIn('class="analytics-case verified-example"', html)
        self.assertNotIn('Проверенные примеры на данных', html)
        self.assertNotIn('сентябре 2026 года', html)
        for target in ('/#how', 'mailto:support@octoport.ru?subject=Бета%20Октопорт'):
            self.assertIn('href="' + target + '"', html)
    def test_analytics_and_home_show_selected_business_cases(self):
        analytics = (ROOT / 'seller-analytics.html').read_text()
        self.assertEqual(analytics.count('class="analytics-case"'), 3)
        for term in (
            'Сравнить продажи за два периода',
            'Проверить позиции товаров в поиске',
            'Посчитать юнит-экономику товара за месяц',
            'поисковым запросам мои товары находятся выше или ниже',
            'маржинальный вклад после расходов маркетплейса',
        ):
            self.assertIn(term, analytics)
        for removed in (
            'Если по запросу данных нет, это отмечается отдельно',
            'Это не называется чистой прибылью',
            'неразносимое хранение показывается отдельно',
        ):
            self.assertNotIn(removed, analytics)
        for removed in ('Сопоставить рекламу с остатками', 'Подготовить отчёт для себя или команды'):
            self.assertNotIn(removed, analytics)
        self.assertIn('Ниже — три примера задач', analytics)
        for term in (
            '«Как изменились продажи?»',
            '«Где просели позиции в поиске?»',
            '«Какие SKU съедают маржу?»',
            'юнит-экономику по SKU',
        ):
            self.assertIn(term, self.home)

    def test_owner_copy_corrections_and_crossed_text_removals(self):
        analytics = (ROOT / 'seller-analytics.html').read_text()
        self.assertIn('Октопорт позволяет получить нейросети доступ к данным вашего кабинета селлера.', analytics)
        self.assertIn('Просто задайте вопрос в диалоге. Нейросеть запросит нужные ей для ответа данные через Октопорт', analytics)
        self.assertIn('Вы продолжаете общаться в режиме диалога с привычной вам Нейросетью, но при этом у неё появляется доступ к данным вашего кабинета селлера', self.home)
        self.assertIn('Модель анализирует, сравнивает, объясняет и помогает принимать решения на основе реальных данных вашего магазина.', self.home)
        self.assertNotIn('Нейросеть + данные вашего магазина.', self.home)
        self.assertNotIn('а доступ к кабинету остаётся только на чтение.', self.home)
        self.assertIn('<a class="button primary" href="#features">Возможности</a>', self.home)
        self.assertNotIn('<a class="button primary" href="#beta">Попробовать</a>', self.home)

    def test_owner_centered_sections_layout(self):
        css = (ROOT / 'styles.css').read_text()
        for term in (
            '.features > .section-intro,',
            '.workflow-heading {',
            'text-align:center;',
            '.employee-copy {',
            '.data {',
            '.public-page {',
            '.page-section {',
            '.analytics-case > h3,',
            '#analytics-access .page-actions { justify-content:center; }',
        ):
            self.assertIn(term, css)
        self.assertIn('/styles.css?v=capability-dropdown-r27-20260929', self.home)
        analytics = (ROOT / 'seller-analytics.html').read_text()
        self.assertIn('/styles.css?v=capability-dropdown-r27-20260929', analytics)

    def test_capability_grid_is_two_columns_except_phone(self):
        css = (ROOT / 'styles.css').read_text()
        self.assertIn('.capability-groups { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; align-items:start; }', css)
        self.assertIn('.capability-group[open] { grid-column:auto; }', css)
        self.assertIn('justify-content:flex-start', css)
        self.assertIn('min-height:58px', css)
        self.assertIn('font-size:17px', css)
        self.assertIn('.capability-group .capability-grid { grid-template-columns:minmax(0,1fr); padding:16px; }', css)
        self.assertIn('@media (max-width:620px) { .capability-groups { grid-template-columns:minmax(0,1fr); } .capability-group[open] { grid-column:auto; }', css)

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
