"""Brand colouring must not alter labels, metadata, instructions or the mascot."""
from html.parser import HTMLParser
from pathlib import Path
import re,unittest
ROOT=Path(__file__).resolve().parents[3]/'apps/site/public'
RX=re.compile(r'(?<![\w@])(?:Ozon|Wildberries|WB)(?!\w|\.[A-Za-z])')
class Names(HTMLParser):
 def __init__(self,html):
  super().__init__(convert_charrefs=False);self.stack=[];self.names=[];self.bad=[];self.feed(html)
 def handle_starttag(self,tag,attrs):
  attrs=dict(attrs)
  if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:self.stack.append((tag,attrs))
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,-1,-1):
   if self.stack[i][0]==tag:self.stack=self.stack[:i];break
 def handle_data(self,text):
  if not any(t=='body' for t,a in self.stack) or any(t in {'script','style','svg','pre','code','textarea'} for t,a in self.stack):return
  for m in RX.finditer(text):
   cls='brand-ozon' if m[0]=='Ozon' else 'brand-wildberries';self.names.append(m[0])
   if not any(cls in a.get('class','').split() for t,a in self.stack):self.bad.append(m[0])
class BrandNamesTests(unittest.TestCase):
 def test_all_five_pages_have_only_coloured_marketplace_names(self):
  for p in sorted(ROOT.glob('*.html')):
   with self.subTest(page=p.name):
    parsed=Names(p.read_text());self.assertTrue(parsed.names);self.assertEqual(parsed.bad,[])
 def test_global_dark_only_brand_rules(self):
  css=(ROOT/'styles.css').read_text()
  for expected in ['.brand-ozon { color:#4e93ff; }','.brand-wildberries { color:#f15cdd; }']:self.assertIn(expected,css)
  self.assertNotIn('theme-checkbox',css)
  self.assertNotIn('.brand-ozon { color:#005bff; }',css)
  self.assertNotIn('.brand-wildberries { color:#bd0ca5; }',css)
 def test_metadata_and_instruction_terms_are_unchanged(self):
  for p in ROOT.glob('*.html'):
   head=p.read_text().split('</head>',1)[0];self.assertNotIn('data-marketplace',head)
  html=(ROOT/'install.html').read_text()
  for term in ['Client ID + API key','Admin read only','Personal token','credentials','noindex, follow']:self.assertIn(term,html)
if __name__=='__main__':unittest.main()

[executed on device: Easyscript (f261eba5-9605-4636-9cde-e4082a541a86)]