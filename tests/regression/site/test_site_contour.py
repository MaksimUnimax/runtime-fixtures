"""Owner-selected Contour source contract. Browser/live evidence remains separate."""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import base64
import zlib
import json
import xml.etree.ElementTree as ET
import re
import struct
import unittest

ROOT = Path(__file__).resolve().parents[3] / 'apps/site/public'

# R6 scene contract: the octopus/grips are path-only SVG layers; live acceptance remains separate.
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
    def test_r10_exact_reference_vector_contract(self):
        source=ROOT.parent/'design-sources'
        m=json.loads((source/'contour-exact-ref-r10.json').read_text())
        asset=ROOT/'assets/contour-exact-ref-r10.svg'
        self.assertEqual(hashlib.sha256(asset.read_bytes()).hexdigest(),m['asset_sha256'])
        svg=asset.read_text()
        self.assertIn('<symbol id="underlay"',svg)
        self.assertNotIn('<image',svg)
        self.assertNotIn('data:image',svg)
        self.assertNotIn('.png',svg)
        self.assertNotIn('.webp',svg)
        self.assertGreater(svg.count('Q'),100)
        self.assertLess(len(svg.encode()),100000)
        self.assertIn('/assets/contour-exact-ref-r10.svg#underlay',self.html)
        self.assertNotIn('contour-spline-r9.svg',self.html)
        self.assertNotIn('contour-grips',self.html)
        self.assertEqual(m['source_reference_size'],[1448,1086])
        self.assertEqual(m['source_reference_sha256'],'d3ead9dbba9794c57a3ff2b1267b15c36045eadd9922e7d6a8788a071e73c246')

    def test_r10_reference_geometry_and_palette(self):
        m=json.loads((ROOT.parent/'design-sources/contour-exact-ref-r10.json').read_text())
        self.assertEqual(m['palette'],{'light':'#10243c','dark':'#ebffff'})
        self.assertIn('.contour-exact-r10 { color:var(--scene-ink);',self.css)
        self.assertIn('aspect-ratio:4/3',self.css)
        expected=m['button_geometry']
        for name,(left,top,width) in expected.items():
            block=re.search(r'(?m)^\s*\.pos-'+name+r'\s*\{([^}]+)\}',self.css).group(1)
            self.assertAlmostEqual(float(re.search(r'left:\s*([\d.]+)%',block).group(1)),left,places=5)
            self.assertAlmostEqual(float(re.search(r'top:\s*([\d.]+)%',block).group(1)),top,places=5)
            if name in ('wb','ozon'):
                self.assertIn('width:18.922652%',self.css)
            elif name in ('alice','gemini'):
                self.assertIn('width:12.154696%',self.css)
            else:
                self.assertIn('width:12.430939%',self.css)
        self.assertIn('--scene-ink:#10243c',self.css)
        self.assertIn('--scene-ink:#ebffff',self.css)

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
            self.assertIn('/assets/contour-mark-'+name+'-r4-light.svg',self.html)
            self.assertTrue((ROOT/('assets/contour-mark-'+name+'-r4-light.svg')).is_file())

    def test_reference_monochrome_vectors_and_static_grips(self):
        for name in ['alice','gemini','chatgpt','deepseek','anthropic','qwen','wb','ozon']:
            for theme,ink in [('light','#10243c'),('dark','#ebffff')]:
                src='/assets/contour-mark-'+name+'-r4-'+theme+'.svg'
                self.assertIn(src,self.html)
                svg=(ROOT/src.lstrip('/')).read_text()
                self.assertEqual(set(re.findall(r'#[0-9a-fA-F]{6}',svg)),{ink})
                self.assertNotIn('<image',svg)
                self.assertNotIn('Gradient',svg)
                self.assertNotIn('url(',svg)
        self.assertNotIn('linear-gradient(145deg',self.css)
        self.assertNotIn('class="contour-orbit"',self.html)
        self.assertIn('background:var(--scene-paper)',self.css)
        self.assertIn('--scene-paper:var(--bg)',self.css)
        grips=[a for t,a in self.tags if t=='svg' and 'contour-grips' in a.get('class','').split()]
        self.assertEqual(len(grips),0)
        block=re.search(r'\.contour-underlay\s*\{([^}]+)\}',self.css).group(1)
        self.assertIn('pointer-events:none',block.replace(' ',''))
        for forbidden in ['transform','transition','animation']:self.assertNotIn(forbidden,block)

    def test_reference_static_layer_has_no_duplicate_discs(self):
        source=ROOT.parent/'design-sources'
        m=json.loads((source/'contour-reference-r4.json').read_text())
        raw=zlib.decompress(base64.b64decode((source/'contour-reference-r4-alpha.b64').read_text()))
        self.assertEqual(hashlib.sha256(raw).hexdigest(),m['alpha_sha256'])
        self.assertEqual(len(raw),559*419)
        for badge in m['badge_cutouts']:
            cx,cy,r=badge['cx'],badge['cy'],badge['radius']
            for y in range(max(0,int(cy-r)),min(419,int(cy+r)+1)):
                for x in range(max(0,int(cx-r)),min(559,int(cx+r)+1)):
                    if (x-cx)**2+(y-cy)**2<r*r:self.assertEqual(raw[y*559+x],0,badge['name'])
        for fragment in re.findall(r'<a class="(?:ai-badge|market-badge)[^>]*>(.*?)</a>',self.html,re.S):
            self.assertNotIn('underlay',fragment);self.assertNotIn('grips',fragment)
            self.assertNotIn('.webp',fragment)

    def test_tablet_stacking_precedes_mobile_breakpoint(self):
        self.assertIn('@media (max-width:1180px)',self.css)
        block=self.css.split('@media (max-width:1180px)',1)[1].split('@media',1)[0]
        self.assertIn('grid-template-columns:minmax(0,1fr)',block)
        self.assertIn('max-width:780px',block)
        self.assertIn('width:100%',block)

    def test_r3_slogan_below_scene_not_inside_art(self):
        self.assertEqual(self.html.count('class="contour-slogan"'),1)
        scene_end=self.html.index('          </div>',self.html.index('class="contour-scene"'))
        slogan=self.html.index('class="contour-slogan"')
        self.assertLess(scene_end,slogan)
        self.assertIn('Сложные технологии.<br />Простые решения.',self.html)
        self.assertIn('.contour-slogan',self.css)

    def test_r3_single_h1_preserves_words_with_color_spans(self):
        fragment=re.findall(r'<h1>(.*?)</h1>',self.html,re.S)
        self.assertEqual(len(fragment),1)
        self.assertEqual(re.sub(r'<[^>]+>','',fragment[0]),'Подключите ваш ИИ к Ozon и Wildberries')
        self.assertIn('<span class="brand-ozon">Ozon</span>',fragment[0])
        self.assertIn('<span class="brand-wildberries">Wildberries</span>',fragment[0])

    def test_r4_theme_aware_rings_and_keyboard_controls(self):
        self.assertIn('border:clamp(1.2px,.30cqi,2.1px) solid var(--scene-ink)',self.css)
        self.assertIn('--scene-ink:#10243c',self.css)
        self.assertIn('--scene-ink:#ebffff',self.css)
        self.assertIn('.ai-badge:focus-visible,.market-badge:focus-visible',self.css)
        self.assertIn('min-width:44px; min-height:44px',self.css)
        self.assertNotIn('border-color:#8295f4',self.css)

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
