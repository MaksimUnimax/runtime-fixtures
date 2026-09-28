"""R9 smooth spline reconstruction of the accepted reference alpha."""
from pathlib import Path
from PIL import Image, ImageDraw
import base64, zlib, math, hashlib, json

ROOT=Path(__file__).resolve().parents[3]
S=ROOT/"apps/site/design-sources"
A=ROOT/"apps/site/public/assets"

raw=zlib.decompress(base64.b64decode((S/"contour-reference-r4-alpha.b64").read_text()))
assert hashlib.sha256(raw).hexdigest()=="904997e09f1cec29f56b80deef12ff773619cbf4ffdb760e3a5b51d08e6b6b05"
alpha=Image.frombytes("L",(559,419),raw).point(lambda v: round(255*(1-(1-v/255)**3)))

def edge_loops(mask, threshold=72, scale=3):
    im=mask.resize((mask.width*scale,mask.height*scale),Image.BICUBIC)
    px=im.load(); w,h=im.size
    fg={(x,y) for y in range(h) for x in range(w) if px[x,y]>=threshold}
    edges={}
    def add(a,b): edges.setdefault(a,[]).append(b)
    for x,y in fg:
        if (x,y-1) not in fg:add((x,y),(x+1,y))
        if (x+1,y) not in fg:add((x+1,y),(x+1,y+1))
        if (x,y+1) not in fg:add((x+1,y+1),(x,y+1))
        if (x-1,y) not in fg:add((x,y+1),(x,y))
    def rank(prev,cur,nxt):
        dx1,dy1=cur[0]-prev[0],cur[1]-prev[1]
        dx2,dy2=nxt[0]-cur[0],nxt[1]-cur[1]
        cross=dx1*dy2-dy1*dx2; dot=dx1*dx2+dy1*dy2
        return (0 if cross<0 else 1 if cross==0 and dot>0 else 2 if cross>0 else 3,nxt)
    unused={(a,b) for a,bs in edges.items() for b in bs}; loops=[]
    while unused:
        a,b=min(unused); pts=[a]; prev,cur=a,b; unused.remove((a,b)); guard=0
        while cur!=a and guard<300000:
            pts.append(cur); guard+=1
            opts=[n for n in edges.get(cur,[]) if (cur,n) in unused]
            if not opts: break
            nxt=min(opts,key=lambda n:rank(prev,cur,n))
            unused.remove((cur,nxt)); prev,cur=cur,nxt
        if cur==a and len(pts)>=4:
            loops.append([(x/scale,y/scale) for x,y in pts])
    return loops

def area(poly):
    return abs(sum(poly[i][0]*poly[(i+1)%len(poly)][1]-poly[(i+1)%len(poly)][0]*poly[i][1] for i in range(len(poly)))/2)

def rdp_open(points, eps):
    if len(points)<3:return points
    a,b=points[0],points[-1]; ax,ay=a; bx,by=b
    den=math.hypot(bx-ax,by-ay) or 1
    best=-1; idx=-1
    for i,(x,y) in enumerate(points[1:-1],1):
        d=abs((by-ay)*x-(bx-ax)*y+bx*ay-by*ax)/den
        if d>best:best=d;idx=i
    if best>eps:
        left=rdp_open(points[:idx+1],eps); right=rdp_open(points[idx:],eps)
        return left[:-1]+right
    return [a,b]
def closed_rdp(poly, eps):
    n=len(poly)
    if n<8:return poly
    i=min(range(n),key=lambda k:(poly[k][0],poly[k][1]))
    j=max(range(n),key=lambda k:(poly[k][0],-poly[k][1]))
    if i>j:i,j=j,i
    c1=poly[i:j+1]
    c2=poly[j:]+poly[:i+1]
    p1=rdp_open(c1,eps)
    p2=rdp_open(c2,eps)
    out=p1[:-1]+p2[:-1]
    clean=[]
    for p in out:
        if not clean or math.hypot(p[0]-clean[-1][0],p[1]-clean[-1][1])>.18:
            clean.append(p)
    return clean

def fmt(v):
    s=f"{v:.2f}".rstrip("0").rstrip(".")
    return s or "0"

def smooth_path(poly):
    ar=area(poly)
    xs=[p[0] for p in poly]; ys=[p[1] for p in poly]
    bw=max(xs)-min(xs); bh=max(ys)-min(ys)
    if ar<.9 or max(bw,bh)<1.6:return None
    eps=1.15 if ar>900 else .85 if ar>120 else .52 if ar>16 else .32
    pts=closed_rdp(poly,eps)
    if len(pts)<3:return None
    # Keep tiny decorative shapes crisp; curve real illustration contours.
    if ar<16:
        return "M"+" L".join(f"{fmt(x)},{fmt(y)}" for x,y in pts)+" Z"
    n=len(pts); out=[f"M{fmt(pts[0][0])},{fmt(pts[0][1])}"]
    tension=.155
    for i in range(n):
        p0=pts[(i-1)%n]; p1=pts[i]; p2=pts[(i+1)%n]; p3=pts[(i+2)%n]
        c1=(p1[0]+(p2[0]-p0[0])*tension,p1[1]+(p2[1]-p0[1])*tension)
        c2=(p2[0]-(p3[0]-p1[0])*tension,p2[1]-(p3[1]-p1[1])*tension)
        out.append(f"C{fmt(c1[0])},{fmt(c1[1])} {fmt(c2[0])},{fmt(c2[1])} {fmt(p2[0])},{fmt(p2[1])}")
    out.append("Z")
    return " ".join(out)

loops=edge_loops(alpha,72,3)
paths=[]; kept=[]
for loop in loops:
    p=smooth_path(loop)
    if p:
        paths.append(p); kept.append((area(loop),len(loop)))
print("loops",len(loops),"kept",len(paths),"largest",sorted((round(a,1),n) for a,n in kept)[-12:])
gr=zlib.decompress(base64.b64decode((S/"contour-grips-r4.b64").read_text()))
grip_ink=Image.new("L",(559,419),0)
grip_ink.paste(Image.frombytes("L",(50,39),gr[:1950]),(150,258))
grip_ink.paste(Image.frombytes("L",(50,39),gr[1950:]),(358,258))
grip_ink=grip_ink.point(lambda v: round(255*(1-(1-v/255)**3)))

poly=[(157,264),(164,259),(177,259),(187,264),(192,271),(190,279),(191,286),(183,291),(175,293),(167,291),(161,287),(157,282),(155,273)]
grip_shape=Image.new("L",(559*4,419*4),0); dr=ImageDraw.Draw(grip_shape)
for pts in [poly,[(558-x,y) for x,y in poly]]:
    dr.polygon([(4*x,4*y) for x,y in pts],fill=255)
grip_shape=grip_shape.resize((559,419),Image.LANCZOS)

def paths_for(mask,threshold=72):
    out=[]
    for loop in edge_loops(mask,threshold,3):
        p=smooth_path(loop)
        if p: out.append(p)
    return out

grip_paper=paths_for(grip_shape,72)
grip_ink_paths=paths_for(grip_ink,72)

svg='''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 559 419">
<symbol id="underlay" viewBox="0 0 559 419"><path fill="currentColor" fill-rule="evenodd" d="'''+''.join(paths)+'''"/></symbol>
<symbol id="grip-paper" viewBox="0 0 559 419"><path fill="currentColor" fill-rule="evenodd" d="'''+''.join(grip_paper)+'''"/></symbol>
<symbol id="grip-ink" viewBox="0 0 559 419"><path fill="currentColor" fill-rule="evenodd" d="'''+''.join(grip_ink_paths)+'''"/></symbol>
</svg>'''
asset=A/"contour-spline-r9.svg";asset.write_text(svg)
manifest={
 "source":"accepted contour-reference-r4 alpha",
 "method":"closed RDP + Catmull-Rom cubic spline; tiny contour filtering",
 "palette":{"light":"#10243c","dark":"#ebffff"},
 "underlay_loops":len(paths),"grip_paper_loops":len(grip_paper),"grip_ink_loops":len(grip_ink_paths),
 "asset_sha256":hashlib.sha256(asset.read_bytes()).hexdigest(),"asset_bytes":asset.stat().st_size,
}
(S/"contour-spline-r9.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
print(json.dumps(manifest,ensure_ascii=False))
