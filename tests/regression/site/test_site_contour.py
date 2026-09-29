from html.parser import HTMLParser
from pathlib import Path
import hashlib, json, re, struct, unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3] / "apps/site/public"
SOURCE = ROOT.parent / "design-sources"

class Tags(HTMLParser):
    def __init__(self, html):
        super().__init__(); self.tags=[]; self.feed(html)
    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))

class ContourSourceTests(unittest.TestCase):
    def setUp(self):
        self.html=(ROOT/"index.html").read_text()
        self.css=(ROOT/"styles.css").read_text()
        self.tags=Tags(self.html).tags
        self.manifest=json.loads((SOURCE/"contour-owner-dark-r13.json").read_text())

    def test_eight_genuine_links_and_static_underlay(self):
        badges=[(t,a) for t,a in self.tags if {"ai-badge","market-badge"} & set(a.get("class","").split())]
        self.assertEqual(len(badges),8)
        self.assertEqual(sum("ai-badge" in a["class"] for _,a in badges),6)
        self.assertEqual(sum("market-badge" in a["class"] for _,a in badges),2)
        for tag,a in badges:
            self.assertEqual(tag,"a"); self.assertTrue(a.get("href")); self.assertTrue(a.get("aria-label"))
        self.assertEqual(self.html.count('class="contour-underlay contour-owner-static-r13"'),1)
        self.assertNotIn("engraving-3-underlay",self.html)
        self.assertNotIn("background-position",self.css)

    def test_r13_owner_reference_vector_identity(self):
        asset=ROOT/"assets/contour-owner-static-r13.svg"
        self.assertEqual(hashlib.sha256(asset.read_bytes()).hexdigest(),self.manifest["asset_sha256"])
        self.assertEqual(self.manifest["source_reference_size"],[1448,1086])
        self.assertEqual(self.manifest["source_reference_sha256"],"8402c8faab101c7975d075f1a8bdebc9c2d3f0f64d4367e7ec52313282bbcfb9")
        svg=asset.read_text()
        self.assertIn('viewBox="0 0 1448 1086"',svg)
        self.assertIn('fill="#f4f7fb"',svg)
        self.assertNotIn("<image",svg); self.assertNotIn("data:image",svg)
        self.assertGreater(svg.count(" L"),1000)
        self.assertLess(len(svg.encode()),100000)
        self.assertIn('/assets/contour-owner-static-r13.svg',self.html)
        self.assertNotIn('/assets/contour-exact-trace-r12.svg#underlay',self.html)

    def test_r13_reference_geometry_and_dark_palette(self):
        self.assertEqual(self.manifest["palette"],{"scene":"#f4f7fb","background":"transparent_on_site_dark"})
        self.assertIn("--scene-ink:#f4f7fb",self.css)
        self.assertNotIn("radial-gradient(ellipse at 50% 14%",self.css)
        self.assertIn("color-scheme:dark",self.css)
        for name,(left,top,width) in self.manifest["button_geometry"].items():
            block=re.search(r"(?m)^\s*\.pos-"+name+r"\s*\{([^}]+)\}",self.css).group(1)
            self.assertAlmostEqual(float(re.search(r"left:\s*([\d.]+)%",block).group(1)),left,places=5)
            self.assertAlmostEqual(float(re.search(r"top:\s*([\d.]+)%",block).group(1)),top,places=5)
            self.assertIn(f"width:{width:.6f}%",block)

    def test_marketplaces_are_lower_and_ordered(self):
        def pos(name):
            block=re.search(r"(?m)^\s*\.pos-"+name+r"\s*\{([^}]+)\}",self.css).group(1)
            return tuple(float(re.search(key+r":\s*([\d.]+)%",block).group(1)) for key in ("left","top"))
        self.assertLess(pos("wb")[0],50); self.assertGreater(pos("ozon")[0],50)
        self.assertGreater(pos("wb")[1],70); self.assertGreater(pos("ozon")[1],70)
        for name in ("alice","gemini","chatgpt","deepseek","anthropic","qwen"):
            self.assertLess(pos(name)[1],70)

    def test_header_and_favicon_are_real_assets(self):
        brand=[a for t,a in self.tags if t=="img" and a.get("class")=="brand-logo"]
        self.assertEqual(len(brand),1); self.assertEqual(brand[0]["src"],"/assets/octoport-brand.png")
        for name in ["favicon.png","assets/favicon-contour-v1.png"]:
            b=(ROOT/name).read_bytes(); self.assertEqual(b[:8],b"\x89PNG\r\n\x1a\n")
            self.assertEqual(struct.unpack(">II",b[16:24]),(120,120))
        self.assertEqual((ROOT/"favicon.png").read_bytes(),(ROOT/"assets/favicon-contour-v1.png").read_bytes())

    def test_dark_only_site_and_no_theme_toggle(self):
        self.assertNotIn("theme-checkbox",self.html); self.assertNotIn("theme-switch",self.html)
        self.assertNotIn("theme-checkbox",self.css); self.assertNotIn("theme-switch",self.css)
        self.assertIn("prefers-reduced-motion",self.css)
        for name in ("index","seller-analytics","privacy","support","install"):
            html=(ROOT/(name+".html")).read_text()
            self.assertIn('<meta name="color-scheme" content="dark" />',html)
            self.assertIn('<meta name="theme-color" content="#0d1929" />',html)
            self.assertNotIn('content="light"',html)
        self.assertNotIn("https://fonts.",self.css)
        for font in re.findall(r"url\((/assets/fonts/[^)]+)\)",self.css):
            self.assertTrue((ROOT/font.lstrip("/")).is_file(),font)

    def test_reference_scene_has_no_separate_background(self):
        blocks=re.findall(r"\.contour-scene\s*\{([^}]+)\}",self.css)
        self.assertTrue(blocks)
        self.assertTrue(all("radial-gradient" not in b and "linear-gradient" not in b for b in blocks))
        self.assertTrue(any("background:transparent" in b.replace(" ","") for b in blocks))
        self.assertNotIn("--scene-ink:#052039",self.css)
        self.assertNotIn("light-art",self.css); self.assertNotIn("dark-art",self.css)

    def test_marketplace_controls_share_centered_slots(self):
        self.assertEqual(self.html.count('class="market-logo-slot"'),2)
        self.assertEqual(self.html.count('class="market-label"'),2)
        self.assertIn("text-align:center",self.css)
        for name in ("wb","ozon"):
            src=f"/assets/contour-mark-{name}-r4-dark.svg"
            self.assertIn(src,self.html); self.assertTrue((ROOT/src.lstrip("/")).is_file())
            self.assertNotIn(f"/assets/contour-mark-{name}-r4-light.svg",self.html)

    def test_badge_content_alignment_matches_owner_reference(self):
        expected_marks={
            "alice":("40.09%","45.77%"), "gemini":("39.55%","39.49%"),
            "chatgpt":("40.57%","46.29%"), "deepseek":("40.34%","44.97%"),
            "anthropic":("39.56%","45.36%"), "qwen":("40.00%","46.57%"),
        }
        expected_labels={
            "alice":("74.28%","1.806cqi"), "gemini":("72.85%","1.813cqi"),
            "chatgpt":("73.89%","1.824cqi"), "deepseek":("74.04%","1.690cqi"),
            "anthropic":("71.38%","1.814cqi"), "qwen":("74.50%","1.852cqi"),
        }
        for name,(top,size) in expected_marks.items():
            block=re.search(r"\.pos-"+name+r" img\s*\{([^}]+)\}",self.css,re.S).group(1).replace(" ","")
            self.assertIn("top:"+top,block); self.assertIn("width:"+size,block); self.assertIn("height:"+size,block)
        for name,(top,size) in expected_labels.items():
            block=re.search(r"\.pos-"+name+r" > span\s*\{([^}]+)\}",self.css,re.S).group(1).replace(" ","")
            self.assertIn("top:"+top,block); self.assertIn(size,block)
        wb=re.search(r"\.pos-wb \.market-logo-slot\s*\{([^}]+)\}",self.css,re.S).group(1).replace(" ","")
        ozon=re.search(r"\.pos-ozon \.market-logo-slot\s*\{([^}]+)\}",self.css,re.S).group(1).replace(" ","")
        self.assertIn("top:42.60%",wb); self.assertIn("width:63.0%",wb); self.assertIn("height:35.0%",wb)
        self.assertIn("top:47.67%",ozon); self.assertIn("width:73.5%",ozon); self.assertIn("height:16.5%",ozon)
        self.assertIn(".pos-wb .market-label { top:71.59%; font-size:clamp(6px,2.045cqi,16px); }",self.css)
        self.assertIn(".pos-ozon .market-label { top:71.66%; font-size:clamp(6px,2.100cqi,16px); }",self.css)
        self.assertIn(".market-badge .brand-wildberries { color:#ee20f5; }",self.css)
        self.assertIn(".market-badge .brand-ozon { color:#008cf3; }",self.css)

    def test_dark_monochrome_vectors_and_stationary_background(self):
        for name in ("alice","gemini","chatgpt","deepseek","anthropic","qwen","wb","ozon"):
            src=f"/assets/contour-mark-{name}-r4-dark.svg"
            self.assertIn(src,self.html)
            svg=(ROOT/src.lstrip("/")).read_text()
            self.assertEqual(set(re.findall(r"#[0-9a-fA-F]{6}",svg)),{"#ebffff"})
            self.assertNotIn("<image",svg)
        under=re.search(r"\.contour-underlay\s*\{([^}]+)\}",self.css).group(1)
        self.assertIn("pointer-events:none",under.replace(" ",""))
        for forbidden in ("transform","transition","animation"): self.assertNotIn(forbidden,under)
        self.assertIn("background:transparent",re.search(r"\.ai-badge,.market-badge\s*\{([^}]+)\}",self.css).group(1))

    def test_tablet_stacking_precedes_mobile_breakpoint(self):
        self.assertIn("@media (max-width:1180px)",self.css)
        block=self.css.split("@media (max-width:1180px)",1)[1].split("@media",1)[0]
        self.assertIn("grid-template-columns:minmax(0,1fr)",block)
        self.assertIn("max-width:780px",block)

    def test_slogan_below_scene_not_inside_art(self):
        self.assertEqual(self.html.count('class="contour-slogan"'),1)
        scene_end=self.html.index("          </div>",self.html.index('class="contour-scene"'))
        slogan=self.html.index('class="contour-slogan"')
        self.assertLess(scene_end,slogan)
        self.assertIn("Сложные технологии.<br />Простые решения.",self.html)

    def test_home_h1_and_brand_copy_unchanged(self):
        fragment=re.findall(r"<h1[^>]*>(.*?)</h1>",self.html,re.S)
        self.assertEqual(len(fragment),1)
        plain=" ".join(re.sub(r"<[^>]+>","",re.sub(r"<br\s*/?>"," ",fragment[0])).split())
        self.assertEqual(plain,"Личный помощник на базе любимой Нейросети.")
        self.assertIn("с любой нейросетью на ваш выбор. Алиса, ChatGPT, DeepSeek, Gemini, Qwen и т.д.</p>",self.html)
        self.assertNotIn("hero-ai-list",fragment[0])
        self.assertIn("Так привычный вам ИИ становится <strong>вашим сотрудником.</strong>",self.html)
        self.assertIn("Можно использовать бесплатные аккаунты нейросетей.",self.html)

    def test_dark_rings_keyboard_targets_and_hover_boundary(self):
        self.assertIn("border:clamp(1.4px,.4cqi,3px) solid var(--scene-ink)",self.css)
        self.assertIn(".ai-badge:focus-visible,.market-badge:focus-visible",self.css)
        self.assertIn("min-width:44px; min-height:44px",self.css)
        hover=re.search(r"\.ai-badge:hover,.ai-badge:focus-visible,.market-badge:hover,.market-badge:focus-visible\s*\{([^}]+)\}",self.css).group(1)
        self.assertIn("scale(1.035)",hover)
        self.assertNotIn("contour-underlay",hover)

    def test_local_images_resolve_and_no_executable_javascript(self):
        for tag,a in self.tags:
            if tag=="img": self.assertTrue((ROOT/a["src"].lstrip("/")).is_file(),a["src"])
            if tag=="script": self.assertEqual(a.get("type"),"application/ld+json")
        for name in ("seller-analytics","privacy","support","install"):
            html=(ROOT/(name+".html")).read_text()
            self.assertIn('src="/assets/octoport-brand.png"',html)
            self.assertIn('href="/assets/favicon-contour-v1.png"',html)

if __name__=="__main__": unittest.main()
