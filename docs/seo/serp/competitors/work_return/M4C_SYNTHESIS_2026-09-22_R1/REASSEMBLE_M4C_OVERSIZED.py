from pathlib import Path
import hashlib, json

root = Path(__file__).resolve().parent
manifest = json.loads((root / "M4C_GITHUB_WEB_TRANSPORT_MANIFEST.json").read_text(encoding="utf-8"))

def sha256_file(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

for item in manifest["oversized_logical_files"]:
    out = root / item["logical_file"]
    with out.open("wb") as w:
        for part in item["parts"]:
            with (root / part["file"]).open("rb") as r:
                for chunk in iter(lambda: r.read(1024 * 1024), b""):
                    w.write(chunk)
    assert out.stat().st_size == item["original_bytes"], item["logical_file"]
    assert sha256_file(out) == item["original_sha256"], item["logical_file"]
    print("PASS", item["logical_file"], out.stat().st_size, sha256_file(out))
