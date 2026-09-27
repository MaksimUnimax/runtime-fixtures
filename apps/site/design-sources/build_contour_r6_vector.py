from pathlib import Path
from PIL import Image, ImageDraw
import base64, zlib, math, json, hashlib

ROOT=Path(__file__).resolve().parents[3]
S=ROOT/"apps/site/design-sources"
OUT=ROOT/"apps/site/public/assets"
OUT.mkdir(parents=True,exist_ok=True)

def overprint(mask, passes=3):
    return mask.point(lambda v: round(255*(1-(1-v/255)**passes)))

def edge_loops(mask, threshold=128, scale=2):
    im=mask.resize((mask.width*scale,mask.height*scale),Image.BICUBIC)
    px=im.load(); w,h=im.size
    fg={(x,y) for y in range(h) for x in range(w) if px[x,y]>=threshold}
    edges={}
    def add(a,b):
        edges.setdefault(a,[]).append(b)
    for x,y in fg:
        if (x,y-1) not in fg:add((x,y),(x+1,y))
        if (x+1,y) not in fg:add((x+1,y),(x+1,y+1))
        if (x,y+1) not in fg:add((x+1,y+1),(x,y+1))
        if (x-1,y) not in fg:add((x,y+1),(x,y))
    def turn_rank(prev,cur,nxt):
        dx1,dy1=cur[0]-prev[0],cur[1]-prev[1]
        dx2,dy2=nxt[0]-cur[0],nxt[1]-cur[1]
        cross=dx1*dy2-dy1*dx2
        dot=dx1*dx2+dy1*dy2
        # clockwise boundary: prefer right turn, then straight, then left
        if cross>0:return 2
        if cross==0 and dot>0:return 1
        if cross<0:return 0
        return 3
    unused={(a,b) for a,bs in edges.items() for b in bs}
    loops=[]
    while unused:
        a,b=min(unused); start=(a,b); pts=[a]; prev,cur=a,b
        unused.remove((a,b))
        guard=0
        while cur!=a and guard<200000:
            pts.append(cur); guard+=1
            opts=[n for n in edges.get(cur,[]) if (cur,n) in unused]
            if not opts: break
            nxt=min(opts,key=lambda n:(turn_rank(prev,cur,n),n))
            unused.remove((cur,nxt)); prev,cur=cur,nxt
        if len(pts)>=4 and cur==a:
            loops.append([(x/scale,y/scale) for x,y in pts])
    return loops

def collinear(points):
    out=[]
    n=len(points)
    for i,p in enumerate(points):
        a=points[i-1]; b=points[(i+1)%n]
        if (p[0]-a[0])*(b[1]-p[1])==(p[1]-a[1])*(b[0]-p[0]):
            continue
        out.append(p)
    return out
def path_d(loops):
    chunks=[]
    total=0
    for loop in loops:
        pts=collinear(loop)
        if len(pts)<3:continue
        total+=len(pts)
        def f(v):
            s=f"{v:.1f}"
            return s[:-2] if s.endswith(".0") else s
        chunks.append("M"+" ".join(f(x)+","+f(y) for x,y in pts)+"Z")
    return "".join(chunks),total

raw=zlib.decompress(base64.b64decode((S/"contour-reference-r4-alpha.b64").read_text()))
alpha=overprint(Image.frombytes("L",(559,419),raw),3)

gr=zlib.decompress(base64.b64decode((S/"contour-grips-r4.b64").read_text()))
grip_ink=Image.new("L",(559,419),0)
grip_ink.paste(Image.frombytes("L",(50,39),gr[:1950]),(150,258))
grip_ink.paste(Image.frombytes("L",(50,39),gr[1950:]),(358,258))
grip_ink=overprint(grip_ink,3)

poly=[(157,264),(164,259),(177,259),(187,264),(192,271),(190,279),(191,286),(183,291),(175,293),(167,291),(161,287),(157,282),(155,273)]
grip_shape=Image.new("L",(559*4,419*4),0); d=ImageDraw.Draw(grip_shape)
for pts in [poly,[(558-x,y) for x,y in poly]]:
    d.polygon([(4*x,4*y) for x,y in pts],fill=255)
grip_shape=grip_shape.resize((559,419),Image.LANCZOS)
layers={}
for name,mask in [("underlay",alpha),("grip-paper",grip_shape),("grip-ink",grip_ink)]:
    loops=edge_loops(mask,72,2)
    dstr,points=path_d(loops)
    layers[name]={"d":dstr,"loops":len(loops),"points":points,"bytes":len(dstr.encode())}
    print(name,"loops",len(loops),"points",points,"bytes",layers[name]["bytes"])

svg='''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 559 419">
<symbol id="underlay" viewBox="0 0 559 419"><path fill="currentColor" fill-rule="evenodd" d="'''+layers["underlay"]["d"]+'''"/></symbol>
<symbol id="grip-paper" viewBox="0 0 559 419"><path fill="currentColor" fill-rule="evenodd" d="'''+layers["grip-paper"]["d"]+'''"/></symbol>
<symbol id="grip-ink" viewBox="0 0 559 419"><path fill="currentColor" fill-rule="evenodd" d="'''+layers["grip-ink"]["d"]+'''"/></symbol>
</svg>'''
asset=OUT/"contour-vector-r6.svg"
asset.write_text(svg)
manifest={
    "source_alpha_sha256":"904997e09f1cec29f56b80deef12ff773619cbf4ffdb760e3a5b51d08e6b6b05",
    "grip_alpha_sha256":"899e4d1bdd0ca3cae4eef34938b8923904ba6c2a573c60df5238ca4ec4171d91",
    "vectorization":{"scale":2,"threshold":72,"source_overprint_passes":3,"fill_rule":"evenodd"},
    "palette":{"light":"#10243c","dark":"#ebffff"},
    "layers":{k:{x:v[x] for x in ("loops","points","bytes")} for k,v in layers.items()},
    "asset_sha256":hashlib.sha256(asset.read_bytes()).hexdigest(),
    "asset_bytes":asset.stat().st_size,
}
(S/"contour-vector-r6.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
print("svg bytes",manifest["asset_bytes"],"sha",manifest["asset_sha256"])
