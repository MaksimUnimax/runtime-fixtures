"""Build R5 theme art with stronger ink matching the independent CSS discs."""
from pathlib import Path
from PIL import Image, ImageDraw
import base64, hashlib, json, zlib

S = Path(__file__).resolve().parent
A = S.parent / "public/assets"
PASSES = 3

def overprint(mask):
    return mask.point(lambda v: round(255 * (1 - (1 - v / 255) ** PASSES)))

raw = zlib.decompress(base64.b64decode((S / "contour-reference-r4-alpha.b64").read_text()))
assert hashlib.sha256(raw).hexdigest() == "904997e09f1cec29f56b80deef12ff773619cbf4ffdb760e3a5b51d08e6b6b05"
alpha = Image.frombytes("L", (559, 419), raw)
strong_alpha = overprint(alpha)

grip_raw = zlib.decompress(base64.b64decode((S / "contour-grips-r4.b64").read_text()))
assert hashlib.sha256(grip_raw).hexdigest() == "899e4d1bdd0ca3cae4eef34938b8923904ba6c2a573c60df5238ca4ec4171d91"
grip_ink = Image.new("L", (559, 419), 0)
grip_ink.paste(Image.frombytes("L", (50, 39), grip_raw[:1950]), (150, 258))
grip_ink.paste(Image.frombytes("L", (50, 39), grip_raw[1950:]), (358, 258))
grip_ink = overprint(grip_ink)
poly = [(157,264),(164,259),(177,259),(187,264),(192,271),(190,279),(191,286),(183,291),(175,293),(167,291),(161,287),(157,282),(155,273)]
polys = [poly, [(558-x, y) for x, y in poly]]
grip_shape = Image.new("L", (559*4, 419*4), 0)
draw = ImageDraw.Draw(grip_shape)
for points in polys:
    draw.polygon([(4*x, 4*y) for x, y in points], fill=255)
grip_shape = grip_shape.resize((559,419), Image.LANCZOS)

outputs = []
for theme, ink, bg in [("light",(16,36,60),(245,247,249)), ("dark",(235,255,255),(13,25,41))]:
    art = Image.new("RGBA", alpha.size, ink + (255,))
    art.putalpha(strong_alpha)
    art_path = A / f"contour-reference-r5-{theme}.webp"
    art.save(art_path, lossless=True, method=6)

    grip = Image.composite(Image.new("RGB",(559,419),ink), Image.new("RGB",(559,419),bg), grip_ink).convert("RGBA")
    grip.putalpha(grip_shape)
    grip_path = A / f"contour-grips-r5-{theme}.webp"
    grip.save(grip_path, lossless=True, method=6)
    outputs.extend([art_path, grip_path])
manifest = {
    "source_manifest": "contour-reference-r4.json",
    "source_alpha_sha256": hashlib.sha256(raw).hexdigest(),
    "grip_alpha_sha256": hashlib.sha256(grip_raw).hexdigest(),
    "palette": {"light":"#10243c", "dark":"#ebffff"},
    "ink_overprint_passes": PASSES,
    "alpha_formula": "round(255*(1-(1-a/255)^passes))",
    "assets": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in outputs},
}
(S / "contour-reference-r5.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
print("CONTOUR_R5_REBUILT", manifest["assets"])
