"""Owner-selected Contour source contract. Browser/live evidence remains separate."""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import re
import struct
import unittest

ROOT = Path(__file__).resolve().parents[3] / 'apps/site/public'

class Tags(HTMLParser):
    def __init__(self, html):
        super().__init__(); self.tags=[]; self.feed(html)
    def handle_starttag(self, tag, attrs):
        self.tags.append((tag,dict(attrs)))

class ContourSourceTests(unittest.TestCase):
    def setUp(self):
        self.html=(ROOT/'index.html').read_text()
        self.css=(ROOT/'styles.css').read_text()
        self.tags=Tags(self.html).tags
    def test_eight_genuine_links_and_no_crop_images(self):
        badges=[(tag,a) for tag,a in self.tags if {'ai-badge','market-badge'} & set(a.get('class','').split())]
        self.assertEqual(len(badges),8)
        self.assertEqual(sum('ai-badge' in a['class'] for _,a in badges),6)
        self.assertEqual(sum('market-badge' in a['class'] for _,a in badges),2)
        for tag,a in badges:
            self.assertEqual(tag,'a'); self.assertTrue(a.get('href')); self.assertTrue(a.get('aria-label'))
        self.assertNotIn('<image',self.html)
        self.assertNotIn('reference-art.js',self.html)
        self.assertNotIn('background-position',self.css)
        self.assertNotIn('engraving-3-underlay',self.html)
    def test_clean_source_and_two_static_theme_layers(self):
        source=ROOT/'assets/contour-2-underlay.webp'
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),'8b2e1c1783c48f5f8037205ea3dd93b25162017a40c463a1d5d9dd726659219e')
        underlays=[a for t,a in self.tags if t=='img' and 'contour-underlay' in a.get('class','').split()]
        self.assertEqual(len(underlays),2)
        block=re.search(r'\.contour-underlay\s*\{([^}]+)\}',self.css).group(1)
        self.assertIn('pointer-events:none',block.replace(' ',''))
        self.assertNotIn('transform',block)
        self.assertNotIn('transition',block)
        self.assertNotIn('animation',block)
    def test_marketplaces_are_lower_and_ordered(self):
        def pos(name):
            block=re.search(r'(?m)^\s*\.pos-'+name+r'\s*\{([^}]+)\}',self.css).group(1)
            return tuple(float(re.search(key+r':\s*([\d.]+)%',block).group(1)) for key in ('left','top'))
        self.assertLess(pos('wb')[0],50); self.assertGreater(pos('ozon')[0],50)
        self.assertGreater(pos('wb')[1],70); self.assertGreater(pos('ozon')[1],70)
        for name in ('alice','gemini','chatgpt','deepseek','anthropic','qwen'):
            self.assertLess(pos(name)[1],50)
    def test_header_and_favicon_are_real_assets(self):
        brand=[a for t,a in self.tags if t=='img' and a.get('class')=='brand-logo']
        self.assertEqual(len(brand),1)
        self.assertEqual(brand[0]['src'],'/assets/octoport-brand.png')
        self.assertGreaterEqual(int(brand[0]['width']),32)
        for name in ['favicon.png','assets/favicon-contour-v1.png']:
            b=(ROOT/name).read_bytes(); self.assertEqual(b[:8],b'\x89PNG\r\n\x1a\n'); self.assertEqual(struct.unpack('>II',b[16:24]),(120,120)); self.assertGreater(len(b),2000)
        self.assertEqual((ROOT/'favicon.png').read_bytes(),(ROOT/'assets/favicon-contour-v1.png').read_bytes())
    def test_native_controls_and_self_hosted_font(self):
        self.assertIn('<details class="site-menu">',self.html)
        self.assertIn('for="theme-checkbox"',self.html)
        self.assertIn('theme-checkbox:focus-visible',self.css)
        self.assertIn('prefers-reduced-motion',self.css)
        self.assertNotIn('https://fonts.',self.css)
        fonts=re.findall(r'url\((/assets/fonts/[^)]+)\)',self.css)
        self.assertTrue(fonts)
        for name in fonts: self.assertTrue((ROOT/name.lstrip('/')).is_file(),name)
    def test_no_rectangular_scene_background(self):
        block=re.search(r'\.contour-scene\s*\{([^}]+)\}',self.css).group(1)
        self.assertIn('background:transparent',block.replace(' ',''))
        self.assertNotIn('box-shadow',block)
        self.assertNotIn('background:var(--art-paper)',self.css)

    def test_marketplace_controls_share_centered_slots(self):
        self.assertEqual(self.html.count('class="market-logo-slot"'),2)
        self.assertEqual(self.html.count('class="market-label"'),2)
        self.assertNotIn('.market-badge b',self.css)
        self.assertNotIn('.pos-ozon b',self.css)
        self.assertIn('text-align:center',self.css)
        for name in ['wb','ozon']:
            self.assertIn('/assets/color-'+name+'-r2.svg',self.html)
            self.assertTrue((ROOT/('assets/color-'+name+'-r2.svg')).is_file())

    def test_all_ai_colors_are_preserved_in_both_themes(self):
        self.assertNotIn('brightness(0) invert(1)',self.css)
        for name in ['alice','gemini','chatgpt','deepseek','anthropic','qwen']:
            src='/assets/color-'+name+'-r2.svg'
            self.assertIn(src,self.html)
            svg=(ROOT/src.lstrip('/')).read_text()
            self.assertRegex(svg,r'#[0-9a-fA-F]{6}')
            self.assertNotIn('currentColor',svg)
            self.assertNotIn('<image',svg)
        self.assertIn('#005bff',self.css)
        self.assertIn('#e313bf',self.css)

    def test_tablet_stacking_precedes_mobile_breakpoint(self):
        self.assertIn('@media (max-width:1180px)',self.css)
        block=self.css.split('@media (max-width:1180px)',1)[1].split('@media',1)[0]
        self.assertIn('grid-template-columns:minmax(0,1fr)',block)
        self.assertIn('max-width:780px',block)
        self.assertIn('width:100%',block)

    def test_local_images_resolve_and_no_executable_javascript(self):
        for tag,a in self.tags:
            if tag=='img': self.assertTrue((ROOT/a['src'].lstrip('/')).is_file(),a['src'])
            if tag=='script': self.assertEqual(a.get('type'),'application/ld+json')
        for name in ('seller-analytics','privacy','support','install'):
            html=(ROOT/(name+'.html')).read_text()
            self.assertIn('src="/assets/octoport-brand.png"',html)
            self.assertIn('href="/assets/favicon-contour-v1.png"',html)
            self.assertNotIn('class="brand-mark"',html)

if __name__=='__main__': unittest.main()
