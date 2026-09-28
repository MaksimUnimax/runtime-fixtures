from pathlib import Path
import base64, zlib, hashlib, json, sys
import cv2
import numpy as np

W,H=1448,1086
repo=Path(__file__).resolve().parents[3]
packed=zlib.decompress(base64.b64decode((repo/"apps/site/design-sources/contour-full-ref-r11-mask.b64").read_bytes()))
assert hashlib.sha256(packed).hexdigest()=="0ae0daac07ecce159ee385bda713f185dc7d53532ad401360fa4dba910c77445"
bits=np.unpackbits(np.frombuffer(packed,dtype=np.uint8))[:W*H]
mask=(bits.reshape(H,W)*255).astype(np.uint8)
contours,hierarchy=cv2.findContours(mask,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_NONE)

def f(v):
    s=f"{float(v):.2f}".rstrip("0").rstrip(".")
    return s or "0"

def quadratic_path(points):
    pts=[tuple(map(float,p)) for p in points]
    n=len(pts)
    if n<3:
        return ""
    last=pts[-1]; first=pts[0]
    start=((last[0]+first[0])/2,(last[1]+first[1])/2)
    out=[f"M{f(start[0])},{f(start[1])}"]
    for i,p in enumerate(pts):
        q=pts[(i+1)%n]
        mid=((p[0]+q[0])/2,(p[1]+q[1])/2)
        out.append(f"Q{f(p[0])},{f(p[1])} {f(mid[0])},{f(mid[1])}")
    out.append("Z")
    return " ".join(out)

paths=[]
stats=[]
for cnt in contours:
    area=abs(cv2.contourArea(cnt))
    if area < 1:
        continue
    peri=cv2.arcLength(cnt,True)
    if area>25000:
        eps=max(.65,peri*.00065)
    elif area>4000:
        eps=max(.50,peri*.00055)
    elif area>300:
        eps=max(.35,peri*.00045)
    else:
        eps=max(.22,peri*.00035)
    approx=cv2.approxPolyDP(cnt,eps,True)
    pts=approx[:,0,:]
    d=quadratic_path(pts)
    if d:
        paths.append(d)
        stats.append((area,peri,len(cnt),len(pts)))

svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">
<symbol id="underlay" viewBox="0 0 {W} {H}">
<path fill="currentColor" fill-rule="evenodd" d="{"".join(paths)}"/>
</symbol>
</svg>
'''
asset=repo/"apps/site/public/assets/contour-full-ref-r11.svg"
asset.write_text(svg)
manifest={
    "source_reference_size":[W,H],
    "source_mask_packed_sha256":hashlib.sha256(packed).hexdigest(),
    "method":"full canonical reference; no button cutouts; cleaned mask -> OpenCV contours -> low-epsilon polygon simplification -> quadratic midpoint smoothing",
    "asset":"assets/contour-full-ref-r11.svg",
    "asset_sha256":hashlib.sha256(asset.read_bytes()).hexdigest(),
    "asset_bytes":asset.stat().st_size,
    "contours":len(paths),
    "palette":{"light":"#10243c","dark":"#ebffff"},
}
(repo/"apps/site/design-sources/contour-full-ref-r11.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
print(json.dumps(manifest,ensure_ascii=False))
print("largest",sorted(stats,reverse=True)[:12])
