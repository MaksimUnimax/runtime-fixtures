from html.parser import HTMLParser
from pathlib import Path
import re,struct,unittest

ROOT=Path(__file__).resolve().parents[3]/'apps/site/public'

class Tags(HTMLParser):
    def __init__(self,html): super().__init__(); self.tags=[]; self.feed(html)
    def handle_starttag(self,tag,attrs): self.tags.append((tag,dict(attrs)))

class HeroSourceTests(unittest.TestCase):
    def setUp(self):
        self.html=(ROOT/'index.html').read_text(); self.css=(ROOT/'styles.css').read_text(); self.tags=Tags(self.html).tags

    def test_owner_selected_text_first_hero(self):
        self.assertIn('class="hero shell" aria-labelledby="hero-title"',self.html)
        self.assertNotIn('class="hero-kicker"',self.html)
        self.assertIn('id="hero-title">Личный помощник на <br />базе любимой <span>Нейросети.</span></h1>',self.html)
        self.assertNotIn('class="contour-wrap"',self.html)
        self.assertNotIn('class="contour-scene"',self.html)
        self.assertNotIn('class="ai-badge',self.html)
        self.assertNotIn('class="market-badge',self.html)

    def test_provider_names_have_separate_owner_colors(self):
        for cls,name in [('brand-alice','Алиса'),('brand-chatgpt','ChatGPT'),('brand-deepseek','DeepSeek'),('brand-gemini','Gemini'),('brand-qwen','Qwen')]:
            self.assertIn(f'<span class="{cls}">{name}</span>',self.html)
            self.assertRegex(self.css,rf'\.{cls}\s*\{{[^}}]*color:#[0-9a-fA-F]{{6}}')
        self.assertIn('class="brand-ozon" data-marketplace="name">Ozon</span>',self.html)
        self.assertIn('class="brand-wildberries" data-marketplace="name">Wildberries</span>',self.html)

    def test_owner_copy_is_preserved(self):
        self.assertIn('с любой нейросетью на ваш выбор.',self.html)
        self.assertIn('Так привычный вам ИИ становится <strong>вашим сотрудником.</strong>',self.html)
        self.assertIn('Можно использовать бесплатные аккаунты нейросетей.',self.html)

    def test_owner_correction_removes_outer_lines_and_restores_octopus(self):
        self.assertNotIn('class="hero-space"',self.html)
        self.assertNotIn('class="hero-orbit',self.html)
        self.assertNotIn('class="hero-horizon"',self.html)
        self.assertIn('class="hero-divider"',self.html)
        self.assertIn('class="hero-mascot"',self.html)
        self.assertIn('src="/assets/contour-owner-static-r13.svg"',self.html)
        self.assertIn('.hero-mascot {',self.css)

    def test_two_real_cta_links(self):
        self.assertIn('<a class="button primary" href="#beta">Попробовать</a>',self.html)
        self.assertIn('<a class="button secondary" href="#how">Как это работает</a>',self.html)

    def test_dark_only_site_and_no_theme_toggle(self):
        self.assertNotIn('theme-checkbox',self.html); self.assertNotIn('theme-switch',self.html)
        self.assertIn('color-scheme:dark',self.css)
        for name in ('index','seller-analytics','privacy','support','install'):
            html=(ROOT/(name+'.html')).read_text(); self.assertIn('<meta name="color-scheme" content="dark" />',html); self.assertNotIn('content="light"',html)

    def test_header_is_owner_reference_shape(self):
        self.assertIn('.header-nav { display:none; }',self.css)
        self.assertIn('class="login-link"',self.html); self.assertIn('class="site-menu"',self.html)

    def test_responsive_hero_contract(self):
        self.assertIn('@media (max-width:760px)',self.css)
        self.assertIn('.hero-heading br { display:none; }',self.css)
        self.assertIn('@media (max-width:480px)',self.css)
        self.assertIn('.hero-actions { flex-direction:column;',self.css)

    def test_header_and_favicon_assets_resolve(self):
        brand=[a for t,a in self.tags if t=='img' and a.get('class')=='brand-logo']; self.assertEqual(len(brand),1); self.assertTrue((ROOT/brand[0]['src'].lstrip('/')).is_file())
        for name in ['favicon.png','assets/favicon-contour-v1.png']:
            b=(ROOT/name).read_bytes(); self.assertEqual(b[:8],b'\x89PNG\r\n\x1a\n'); self.assertEqual(struct.unpack('>II',b[16:24]),(120,120))

    def test_local_images_and_no_executable_javascript(self):
        for tag,a in self.tags:
            if tag=='img': self.assertTrue((ROOT/a['src'].lstrip('/')).is_file(),a['src'])
            if tag=='script': self.assertEqual(a.get('type'),'application/ld+json')

    def test_theme_asset_cache_key_advanced(self):
        self.assertIn('/styles.css?v=hero-space-r16-20260929',self.html)

if __name__=='__main__': unittest.main()
