from pathlib import Path
import base64, zlib, hashlib, json
import cv2
import numpy as np

W,H=1448,1086
ROOT=Path(__file__).resolve().parents[3]
SOURCE=ROOT/"apps/site/design-sources/contour-exact-ref-r12-mask.b64"
packed=zlib.decompress(base64.b64decode(SOURCE.read_bytes()))
assert hashlib.sha256(packed).hexdigest()=="5c3dc4259d3bc47754f8683026922731270ae603c362a9ec2a3ea1fd2e1f2833"
bits=np.unpackbits(np.frombuffer(packed,dtype=np.uint8))[:W*H]
mask=(bits.reshape(H,W)*255).astype(np.uint8)
contours,_=cv2.findContours(mask,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)

paths=[]
points=0
for cnt in contours:
    area=abs(cv2.contourArea(cnt))
    if area < 1:
        continue
    pts=cnt[:,0,:]
    if len(pts)<2:
        continue
    paths.append("M"+" L".join(f"{int(x)},{int(y)}" for x,y in pts)+" Z")
    points+=len(pts)

svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">
<symbol id="underlay" viewBox="0 0 {W} {H}">
<path fill="currentColor" fill-rule="evenodd" d="{"".join(paths)}"/>
</symbol>
</svg>
'''

asset=ROOT/"apps/site/public/assets/contour-exact-trace-r12.svg"
asset.write_text(svg)
manifest={
    "source_reference_size":[W,H],
    "source_reference_sha256":"d3ead9dbba9794c57a3ff2b1267b15c36045eadd9922e7d6a8788a071e73c246",
    "source_mask_packed_sha256":hashlib.sha256(packed).hexdigest(),
    "method":"canonical reference mask -> OpenCV CHAIN_APPROX_SIMPLE; no RDP, no spline smoothing, no button cutouts",
    "asset":"assets/contour-exact-trace-r12.svg",
    "asset_sha256":hashlib.sha256(asset.read_bytes()).hexdigest(),
    "asset_bytes":asset.stat().st_size,
    "contours":len(paths),
    "points":points,
    "palette":{"light":"#052039","dark":"#ebffff"},
}
(ROOT/"apps/site/design-sources/contour-exact-trace-r12.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
print(json.dumps(manifest,ensure_ascii=False))
