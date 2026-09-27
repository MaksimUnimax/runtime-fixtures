"""Rebuild R4 static layers from verified reference alpha; Pillow required."""
from pathlib import Path
from PIL import Image, ImageDraw
import base64, zlib, hashlib, json
S=Path(__file__).resolve().parent; A=S.parent/'public/assets'
raw=zlib.decompress(base64.b64decode((S/'contour-reference-r4-alpha.b64').read_text()))
assert hashlib.sha256(raw).hexdigest()=='904997e09f1cec29f56b80deef12ff773619cbf4ffdb760e3a5b51d08e6b6b05'
alpha=Image.frombytes('L',(559,419),raw)
b=zlib.decompress(base64.b64decode((S/'contour-grips-r4.b64').read_text()))
assert hashlib.sha256(b).hexdigest()=='899e4d1bdd0ca3cae4eef34938b8923904ba6c2a573c60df5238ca4ec4171d91'
poly=[(157,264),(164,259),(177,259),(187,264),(192,271),(190,279),(191,286),(183,291),(175,293),(167,291),(161,287),(157,282),(155,273)]
polys=[poly,[(558-x,y) for x,y in poly]]
mask=Image.new('L',(559*4,419*4),0);d=ImageDraw.Draw(mask)
for points in polys:d.polygon([(4*x,4*y) for x,y in points],fill=255)
mask=mask.resize((559,419),Image.LANCZOS)
inkmask=Image.new('L',(559,419),0)
inkmask.paste(Image.frombytes('L',(50,39),b[:1950]),(150,258))
inkmask.paste(Image.frombytes('L',(50,39),b[1950:]),(358,258))
for theme,ink,bg in [('light',(16,36,60),(245,247,249)),('dark',(235,255,255),(13,25,41))]:
 im=Image.new('RGBA',alpha.size,ink+(255,));im.putalpha(alpha)
 im.save(A/f'contour-reference-r4-{theme}.webp',lossless=True,method=6)
 im=Image.composite(Image.new('RGB',(559,419),ink),Image.new('RGB',(559,419),bg),inkmask).convert('RGBA')
 im.putalpha(mask);im.save(A/f'contour-grips-r4-{theme}.webp',lossless=True,method=6)
p=S/'contour-reference-r4.json';m=json.loads(p.read_text())
m['grip_alpha_sha256']=hashlib.sha256(b).hexdigest();m['grip_polygons']=polys
m['assets']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(A.glob('*r4*'))}
p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
print('REFERENCE_AND_GRIPS_REBUILT',len(m['assets']),'assets')
